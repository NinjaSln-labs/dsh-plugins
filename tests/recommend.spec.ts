/**
 * dsh-subagent-router — model recommendation (ROADMAP 2a).
 *
 * Drives `recommend()` directly against a scripted fake `llm` service, plus
 * pure unit tests for the cache key, classifier-reply parser, LRU cache,
 * classifier picker, and heuristic fallback. The degradation ladder is the
 * point under test: a classifier fault must never throw — it degrades to the
 * naming heuristic and reports why.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  recommend,
  parsePicks,
  normalizeTask,
  LruCache,
  pickClassifier,
  heuristicRecommend,
  ScopeStore,
} from '../src/recommend.ts'
import type { RecommendationCore } from '../src/recommend.ts'
import type { SelectionEntry } from '../src/selection.ts'
import { resolveConfig } from '../src/index.ts'
import { RouteHealthStore } from '../src/health.ts'

/** A fake `llm` service with a scripted streaming classifier. */
function fakeLlm(opts: {
  routes: Array<{ id: string; models: string[] }>
  streamText?: string
  streamError?: unknown
  hang?: boolean
}) {
  return {
    listProviders() {
      return opts.routes.map(route => ({ id: route.id, name: route.id }))
    },
    async listModels(provider: string) {
      const route = opts.routes.find(candidate => candidate.id === provider)
      return (route?.models ?? []).map(id => ({ id, name: id }))
    },
    stream(options: { signal?: AbortSignal }) {
      return (async function* () {
        if (opts.hang === true) {
          await new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          })
        }
        if (opts.streamError !== undefined) throw opts.streamError
        yield { type: 'text-delta', index: 0, text: opts.streamText ?? '' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    },
  }
}

function mockCtx(llm: unknown): Context {
  return { get: (name: string) => (name === 'llm' ? llm : undefined) } as unknown as Context
}

const ROUTES = [
  { id: 'deepseek-official', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
  { id: 'pi-ai-cn', models: ['pi-3-mini'] },
]

function runRecommend(
  llm: unknown,
  args: { task: string; provider?: string; n?: number },
  config: Parameters<typeof resolveConfig>[0] = {},
  cache = new LruCache<string, RecommendationCore>(128),
  exec: { signal?: AbortSignal } = { signal: undefined },
  scopeStore = new ScopeStore(),
) {
  return recommend(mockCtx(llm), args, exec, new RouteHealthStore(), () => resolveConfig(config), cache, scopeStore)
}

describe('normalizeTask', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeTask('  Refactor   THE  Module  ')).toBe('refactor the module')
  })

  it('bounds the length to 500 chars', () => {
    const long = 'x'.repeat(1000)
    expect(normalizeTask(long).length).toBe(500)
  })
})

describe('parsePicks', () => {
  it('parses a bare JSON object', () => {
    const picks = parsePicks('{"picks":[{"provider":"p","model":"m","reason":"r"}]}')
    expect(picks).toEqual([{ provider: 'p', model: 'm', reason: 'r' }])
  })

  it('parses a fenced json code block', () => {
    const picks = parsePicks('```json\n{"picks":[{"provider":"p","model":"m","reason":"r"}]}\n```')
    expect(picks).toEqual([{ provider: 'p', model: 'm', reason: 'r' }])
  })

  it('parses JSON with surrounding prose', () => {
    const picks = parsePicks('Here you go: {"picks":[{"provider":"p","model":"m","reason":"r"}]} thanks')
    expect(picks).toEqual([{ provider: 'p', model: 'm', reason: 'r' }])
  })

  it('skips malformed entries and returns undefined when none are valid', () => {
    expect(parsePicks('{"picks":[{"provider":1}]}')).toBeUndefined()
    expect(parsePicks('not json at all')).toBeUndefined()
  })
})

describe('LruCache', () => {
  it('stores, retrieves, and refreshes recency', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1) // a becomes most-recent
    cache.set('c', 3) // evicts b
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
  })
})

describe('pickClassifier', () => {
  it('skips light models and prefers mid over strong (cost) for the classifier host', () => {
    const candidates: SelectionEntry[] = [
      { provider: 'p', model: 'flash-x', tier: 'cheapest', meta: { cost: 'low', speed: 'fast', strength: 'light', specialty: [] } },
      { provider: 'p', model: 'strong-x-pro', tier: 'strong', meta: { cost: 'high', speed: 'normal', strength: 'strong', specialty: [] } },
      { provider: 'p', model: 'mid-x', tier: 'medium', meta: { cost: 'mid', speed: 'normal', strength: 'mid', specialty: [] } },
    ]
    // light 被排除；mid（cost=mid）排在 strong（cost=high）前
    expect(pickClassifier(candidates)).toEqual({ provider: 'p', model: 'mid-x' })
  })

  it('returns undefined for an empty candidate list', () => {
    expect(pickClassifier([])).toBeUndefined()
  })

  it('prefers a listed provider within the same cost tier', () => {
    const candidates: SelectionEntry[] = [
      { provider: 'slow-route', model: 'mid-x', tier: 'medium', meta: { cost: 'mid', speed: 'normal', strength: 'mid', specialty: [] } },
      { provider: 'fast-route', model: 'mid-y', tier: 'medium', meta: { cost: 'mid', speed: 'normal', strength: 'mid', specialty: [] } },
    ]
    // 同 cost 档内，providerOrder 靠前的优先
    expect(pickClassifier(candidates, ['fast-route'])).toEqual({ provider: 'fast-route', model: 'mid-y' })
  })
})

describe('heuristicRecommend', () => {
  const candidates: SelectionEntry[] = [
    { provider: 'p', model: 'coder-x-pro', tier: 'best', meta: { cost: 'high', speed: 'slow', strength: 'strong', specialty: ['code'] } },
    { provider: 'p', model: 'flash-x', tier: 'cheapest', meta: { cost: 'low', speed: 'fast', strength: 'light', specialty: [] } },
  ]

  it('prioritizes a specialty match with a strong tier', () => {
    const picks = heuristicRecommend('debug some code', candidates, 1)
    expect(picks[0]!.model).toBe('coder-x-pro')
    expect(picks[0]!.reason).toContain('code')
  })
})

describe('recommend', () => {
  it('returns the classifier pick when it validates against the catalog', async () => {
    const llm = fakeLlm({
      routes: ROUTES,
      streamText: JSON.stringify({ picks: [{ provider: 'deepseek-official', model: 'deepseek-v4-pro', reason: 'strong model' }] }),
    })
    const result = await runRecommend(llm, { task: 'refactor an architecture' })
    expect(result.source).toBe('llm')
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0]).toMatchObject({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(result.recommendations[0]!.strength).toBe('strong')
    // `recommended` is the explicit system default == top pick
    expect(result.recommended).toEqual(result.recommendations[0])
  })

  it('stamps `recommended` on the heuristic path and omits it when empty', async () => {
    const llm = fakeLlm({
      routes: ROUTES,
      streamText: JSON.stringify({ picks: [{ provider: 'ghost', model: 'ghost-model', reason: 'made up' }] }),
    })
    const result = await runRecommend(llm, { task: 'write code' })
    expect(result.source).toBe('heuristic')
    expect(result.recommended).toEqual(result.recommendations[0])

    const empty = await runRecommend(undefined, { task: 'do a thing' })
    expect(empty.recommendations).toEqual([])
    expect(empty.recommended).toBeUndefined()
  })

  it('drops hallucinated ids and degrades to heuristic', async () => {
    const llm = fakeLlm({
      routes: ROUTES,
      streamText: JSON.stringify({ picks: [{ provider: 'ghost', model: 'ghost-model', reason: 'made up' }] }),
    })
    const result = await runRecommend(llm, { task: 'write code' })
    expect(result.source).toBe('heuristic')
    expect(result.note).toContain('validation')
    expect(result.recommendations.length).toBeGreaterThan(0)
  })

  it('degrades to heuristic when the classifier throws', async () => {
    const llm = fakeLlm({ routes: ROUTES, streamError: new Error('boom') })
    const result = await runRecommend(llm, { task: 'do a thing' })
    expect(result.source).toBe('heuristic')
    expect(result.note).toContain('fell back to heuristic')
  })

  it('labels a quota classification in the degradation note', async () => {
    const llm = fakeLlm({
      routes: ROUTES,
      streamError: Object.assign(new Error('quota exhausted'), { code: 'QUOTA' }),
    })
    const result = await runRecommend(llm, { task: 'do a thing' })
    expect(result.source).toBe('heuristic')
    expect(result.note).toContain('quota exhausted')
  })

  it('degrades on classifier timeout', async () => {
    const llm = fakeLlm({ routes: ROUTES, hang: true })
    const result = await runRecommend(llm, { task: 'do a thing' }, { recommendTimeoutMs: 10 })
    expect(result.source).toBe('heuristic')
    expect(result.note).toContain('timed out')
  })

  it('serves a cache hit without a second classifier call', async () => {
    const stream = vi.fn().mockImplementation(function* () {
      yield { type: 'text-delta', index: 0, text: '{"picks":[{"provider":"deepseek-official","model":"deepseek-v4-flash","reason":"fast"}]}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    const llm = {
      listProviders: () => ROUTES.map(route => ({ id: route.id, name: route.id })),
      listModels: async (provider: string) => {
        const route = ROUTES.find(r => r.id === provider)
        return (route?.models ?? []).map(id => ({ id, name: id }))
      },
      stream,
    }
    const cache = new LruCache<string, RecommendationCore>(128)
    const first = await runRecommend(llm, { task: 'summarize' }, {}, cache)
    expect(first.source).toBe('llm')
    expect(stream).toHaveBeenCalledTimes(1)

    const second = await runRecommend(llm, { task: '  summarize ' }, {}, cache)
    expect(second.note).toContain('cached')
    expect(second.recommendations).toEqual(first.recommendations)
    expect(stream).toHaveBeenCalledTimes(1)
  })

  it('returns empty when the catalog has no candidates', async () => {
    const llm = fakeLlm({ routes: [], streamText: '{}' })
    const result = await runRecommend(llm, { task: 'do a thing' })
    expect(result.source).toBe('heuristic')
    expect(result.recommendations).toEqual([])
    expect(result.note).toContain('no healthy candidate')
  })

  it('returns empty when the llm service is unavailable', async () => {
    const result = await runRecommend(undefined, { task: 'do a thing' })
    expect(result.recommendations).toEqual([])
    expect(result.note).toContain('llm service unavailable')
  })

  it('throws on an empty task', async () => {
    const llm = fakeLlm({ routes: ROUTES })
    await expect(runRecommend(llm, { task: '   ' })).rejects.toThrow('non-empty')
  })

  it('anchors the classifier to the calling agent\'s own model', async () => {
    const seen: Array<{ provider: string; model: string }> = []
    const llm = {
      listProviders: () => ROUTES.map(route => ({ id: route.id, name: route.id })),
      listModels: async (provider: string) => {
        const route = ROUTES.find(r => r.id === provider)
        return (route?.models ?? []).map(id => ({ id, name: id }))
      },
      stream: (options: { provider: string; model: string }) => {
        seen.push({ provider: options.provider, model: options.model })
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: '{"picks":[{"provider":"deepseek-official","model":"deepseek-v4-pro","reason":"x"}]}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }
    const result = await recommend(
      mockCtx(llm),
      { task: 'do a thing' },
      { signal: undefined, agent: { options: { provider: 'parent-route', model: 'parent-model' } } },
      new RouteHealthStore(),
      () => resolveConfig({}),
      new LruCache<string, RecommendationCore>(128),
      new ScopeStore(),
    )
    // 父模型作为分类器首选（锚定），而不是候选池里的 cheap 模型
    expect(seen[0]).toEqual({ provider: 'parent-route', model: 'parent-model' })
    expect(result.recommendations[0]?.model).toBe('deepseek-v4-pro')
  })
})
