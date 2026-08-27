/**
 * dsh-subagent-router — model-chosen subagent delegation.
 *
 * Drives the REAL plugin body on a real `ToolRuntime` + `SubagentRuntime`,
 * with a package-local scripted subagent provider and a faked `llm` route
 * registry, and invokes the registered tools through `ctx.tools.execute`.
 * Continuable background execution is not exercised here: that path is
 * verbatim from the shipped `@deepseek-ai/dsh-tool-subagent` and needs the
 * full agent-loop testkit; only its mount-time capability rejection is
 * covered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider, SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { CallId, LlmError } from '@deepseek-ai/dsh-llm'
import plugin from '../src/index.ts'
import type { ModelPickerConfig } from '../src/index.ts'
import { classifyFailure, failureLabel, sanitizeFailureDetail } from '../src/failure.ts'
import { RouteHealthStore, DEFAULT_TRANSIENT_TTL_MS } from '../src/health.ts'

const testToolSignal = new AbortController().signal

/** A minimal parent Agent passed through to the provider request. */
const fakeAgent = { id: 'parent-1', ctx: undefined } as never

/** Scripted subagent provider that captures every start request. */
class ScriptedProvider implements SubagentProvider {
  readonly inheritsParentContext = false
  readonly capabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  starts: Array<Record<string, unknown>> = []
  reply = 'child says hi'
  /** The first N starts fail with stopReason 'error' (before the reply). */
  failFirstCount = 0
  /** The first N starts reject with the given cause (infrastructure failure). */
  rejectFirstCount = 0
  /** Exact start indexes that reject with the given cause (overrides rejectFirstCount). */
  rejectAtIndex: number[] = []
  /** Cause for start rejections (classification evidence). */
  rejectCause: unknown = new Error('start rejected')
  private startsMade = 0

  constructor(readonly name: string) {}

  // Continuable is the fixed background mode (see `fixedConfig`); the provider
  // must present `prepareContinuable` to mount. Tests run calls in the
  // foreground (`run_in_background: false` injected by callTool) so the
  // scripted start/settle path stays the primary one.
  async prepareContinuable(): Promise<unknown> {
    return { childId: `cont-${this.name}` }
  }

  startContinuable(spec: { childId: string }): unknown {
    return { childId: spec.childId }
  }

  start(request: never) {
    this.starts.push(request as unknown as Record<string, unknown>)
    const index = this.startsMade++
    if (index < this.rejectFirstCount || this.rejectAtIndex.includes(index)) {
      return Promise.reject(this.rejectCause)
    }
    const result: Promise<SubagentResult> = index < this.failFirstCount
      ? Promise.resolve({ output: [], stopReason: 'error' } satisfies SubagentResult)
      : Promise.resolve({
          output: [{ type: 'text', text: this.reply }],
          stopReason: 'completed',
        } satisfies SubagentResult)
    const run: SubagentRun = {
      id: `scripted-${this.name}` as never,
      localAgent: undefined as never,
      result,
      dispose: async () => {},
    }
    return run
  }
}

/** Minimal fake `llm` route registry (no network, no adapters). */
function fakeLlm(routes: Array<{
  id: string
  name: string
  models: Array<{ id: string; name: string }>
  error?: string
}>) {
  return {
    listProviders() {
      return routes.map(({ id, name }) => ({ id, name }))
    },
    async listModels(provider: string) {
      const route = routes.find(candidate => candidate.id === provider)
      if (route === undefined) throw new Error(`no route "${provider}"`)
      if (route.error !== undefined) throw new Error(route.error)
      return route.models.map(model => ({ provider, id: model.id, name: model.name }))
    },
  } as never
}

const DEFAULT_ROUTES = [
  { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }] },
  { id: 'pi-ai-cn', name: 'PI AI CN', models: [{ id: 'pi-3-mini', name: 'PI 3 Mini' }] },
]

/** Three strength tiers so auto escalation has a distinct target. */
const AUTO_ROUTES = [
  {
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-std', name: 'DeepSeek V4 Std' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ],
  },
]

/** A parent whose options name its own provider route. */
const fakeAgentWithRoute = {
  id: 'parent-1',
  ctx: undefined,
  options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
} as never

/** A parent running a strong model on its own route. */
const fakeAgentOnPro = {
  id: 'parent-2',
  ctx: undefined,
  options: { provider: 'deepseek-official', model: 'deepseek-v4-pro' },
} as never

async function setup(config: ModelPickerConfig = {}, options: {
  routes?: Array<{ id: string; name: string; models: Array<{ id: string; name: string }>; error?: string }>
  withLlm?: boolean
  providerName?: string
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  if (options.withLlm !== false) {
    ctx.provide('llm', fakeLlm(options.routes ?? DEFAULT_ROUTES))
  }
  const provider = new ScriptedProvider(options.providerName ?? 'spawn')
  ctx.subagents.registerProvider(provider)
  // The subagent provider is a fixed constant (`fixedConfig.subagentProvider`
  // = 'spawn'); tests register under that name so the plugin mounts.
  await ctx.plugin(plugin, config)
  return { ctx, provider }
}

let callCounter = 0
function callTool(ctx: Context, name: string, args: unknown, agent?: unknown) {
  // Background mode is fixed to continuable; these unit tests exercise the
  // foreground start/settle path, so default every call to foreground (an
  // explicit `run_in_background: true` in `args` overrides this spread).
  const arguments_ = { run_in_background: false, ...(args as Record<string, unknown>) }
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: arguments_,
    ...agent !== undefined ? { agent } : {},
  })
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function propsOf(ctx: Context, name: string): Record<string, unknown> {
  const schema = ctx.tools.schemas().find(candidate => candidate.name === name)
  expect(schema).toBeDefined()
  return (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
}

afterEach(() => {
  callCounter = 0
})

describe('dsh-subagent-router delegation tool', () => {
  it('registers `subagent_model` exposing description/prompt/provider/model/max_tokens/run_in_background', async () => {
    const { ctx } = await setup()
    expect(Object.keys(propsOf(ctx, 'subagent_model')).sort())
      .toEqual(['description', 'max_tokens', 'model', 'prompt', 'provider', 'run_in_background'])
  })

  it('registers the `subagent_models` catalog tool by default', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.schemas().some(candidate => candidate.name === 'subagent_models')).toBe(true)
  })

  it('inherits the parent route when provider/model are omitted', async () => {
    const { ctx, provider } = await setup()
    const result = await callTool(ctx, 'subagent_model', { description: 'do a thing', prompt: 'go research X' }, fakeAgent)
    expect(result.isError).toBe(false)
    expect(provider.starts).toHaveLength(1)
    const request = provider.starts[0]!
    expect(request.agentOptions).toEqual({})
    expect(request.parent).toBe(fakeAgent)
    // Depth cap is fixed to provider-managed (see `fixedConfig`) — no numeric
    // maxDepth is forwarded to the provider.
    expect(request.maxDepth).toBeUndefined()
    expect(text(result)).toBe('child says hi')
  })

  it('passes per-call provider/model/max_tokens into agentOptions', async () => {
    const { ctx, provider } = await setup()
    const result = await callTool(ctx, 'subagent_model', {
      description: 'heavy analysis',
      prompt: 'analyze deeply',
      provider: 'pi-ai-cn',
      model: 'pi-3-mini',
      max_tokens: 2048,
    }, fakeAgent)
    expect(result.isError).toBe(false)
    expect(provider.starts[0]!.agentOptions).toEqual({
      provider: 'pi-ai-cn',
      model: 'pi-3-mini',
      maxTokens: 2048,
    })
  })

  it('rejects an unknown provider route with the registered list', async () => {
    const { ctx } = await setup()
    const result = await callTool(ctx, 'subagent_model', {
      description: 'x',
      prompt: 'y',
      provider: 'nope-provider',
    }, fakeAgent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unknown provider "nope-provider"')
    expect(text(result)).toContain('deepseek-official')
    expect(text(result)).toContain('pi-ai-cn')
  })

  it('rejects an unknown provider even when the route list is empty', async () => {
    const { ctx } = await setup({}, { routes: [] })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'x',
      prompt: 'y',
      provider: 'anything',
    }, fakeAgent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('registered provider routes: (none)')
  })

  it('passes an arbitrary model id through (catalogs are advisory)', async () => {
    const { ctx, provider } = await setup()
    const result = await callTool(ctx, 'subagent_model', {
      description: 'x',
      prompt: 'y',
      model: 'deepseek-some-future-model',
    }, fakeAgent)
    expect(result.isError).toBe(false)
    expect(provider.starts[0]!.agentOptions).toEqual({ model: 'deepseek-some-future-model' })
  })

  it('rejects non-positive or non-integer max_tokens', async () => {
    const { ctx } = await setup()
    // 0 and negative values pass schema validation (integer) and are caught
    // by the runtime guard; 1.5 is rejected by the schema itself.
    for (const maxTokens of [0, -5]) {
      const result = await callTool(ctx, 'subagent_model', {
        description: 'x',
        prompt: 'y',
        max_tokens: maxTokens,
      }, fakeAgent)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('max_tokens must be a positive integer')
    }
    const fractional = await callTool(ctx, 'subagent_model', {
      description: 'x',
      prompt: 'y',
      max_tokens: 1.5,
    }, fakeAgent)
    expect(fractional.isError).toBe(true)
    expect(text(fractional)).toContain('invalid arguments')
  })

  it('requires a calling agent', async () => {
    const { ctx } = await setup()
    const result = await callTool(ctx, 'subagent_model', { description: 'x', prompt: 'y' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })

  it('fails loud at mount when the provider lacks the continuable capability (fixed backgroundMode)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    const provider = new ScriptedProvider('spawn')
    provider.prepareContinuable = undefined as never  // instance shadow beats the prototype method
    ctx.subagents.registerProvider(provider)
    let failure: unknown
    try {
      await ctx.plugin(plugin)
    } catch (error) {
      failure = error
    }
    expect(String(failure)).toContain('does not support')
    expect(String(failure)).toContain('continuable')
  })
})

describe('dsh-subagent-router catalog tool', () => {
  it('lists every registered provider with its models', async () => {
    const { ctx } = await setup()
    const result = await callTool(ctx, 'subagent_models', {})
    expect(result.isError).toBe(false)
    const value = JSON.parse(text(result)) as {
      providers: Array<{
        provider: string
        name: string
        models: Array<{ id: string; name: string }>
        health?: string
      }>
    }
    expect(value.providers).toEqual([
      {
        provider: 'deepseek-official',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', cost: 'low', speed: 'fast', strength: 'light', specialty: [], contextWindow: '128k' }],
        health: 'healthy',
      },
      {
        provider: 'pi-ai-cn',
        name: 'PI AI CN',
        models: [{ id: 'pi-3-mini', name: 'PI 3 Mini', cost: 'low', speed: 'fast', strength: 'light', specialty: [] }],
        health: 'healthy',
      },
    ])
  })

  it('narrows to one provider and reports unknown ones', async () => {
    const { ctx } = await setup()
    const narrowed = await callTool(ctx, 'subagent_models', { provider: 'pi-ai-cn' })
    expect(narrowed.isError).toBe(false)
    expect(JSON.parse(text(narrowed))).toEqual({
      providers: [{
        provider: 'pi-ai-cn',
        name: 'PI AI CN',
        models: [{ id: 'pi-3-mini', name: 'PI 3 Mini', cost: 'low', speed: 'fast', strength: 'light', specialty: [] }],
        health: 'healthy',
      }],
    })
    const unknown = await callTool(ctx, 'subagent_models', { provider: 'ghost' })
    expect(unknown.isError).toBe(false)
    const parsed = JSON.parse(text(unknown)) as { providers: unknown[]; note: string }
    expect(parsed.providers).toEqual([])
    expect(parsed.note).toContain('unknown provider "ghost"')
  })

  it('degrades gracefully when the llm service is absent', async () => {
    const { ctx } = await setup({}, { withLlm: false })
    const result = await callTool(ctx, 'subagent_models', {})
    expect(result.isError).toBe(false)
    expect(JSON.parse(text(result))).toEqual({
      providers: [],
      note: 'llm service unavailable on this harness',
    })
  })
})

describe('dsh-subagent-router auto selection (model "auto")', () => {
  it('picks the cheapest model for a trivial task and records the audit line', async () => {
    const { ctx, provider } = await setup({}, { routes: AUTO_ROUTES })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      provider: 'deepseek-official',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(false)
    expect(provider.starts[0]!.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(text(result)).toContain('child says hi')
    expect(text(result)).toContain('[auto] provider=deepseek-official model=deepseek-v4-flash tier=trivial')
    expect(text(result)).toContain('auto policy:')
  })

  it('picks the strongest model for a code-heavy task', async () => {
    const { ctx, provider } = await setup({}, { routes: AUTO_ROUTES })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'deep code review',
      prompt: '```ts\nfunction f() { return 1 }\n```\nAnalyze this code, design a refactor, and evaluate the complexity tradeoffs in depth.',
      provider: 'deepseek-official',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(false)
    expect(provider.starts[0]!.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(text(result)).toContain('tier=complex')
  })

  it('resolves the provider from the calling agent options when provider is omitted', async () => {
    const { ctx, provider } = await setup({}, { routes: AUTO_ROUTES })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(false)
    expect(provider.starts[0]!.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
  })

  it('fails when no provider route is resolvable', async () => {
    const { ctx } = await setup({}, { routes: AUTO_ROUTES })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('needs a provider route')
  })

  it('fails when the provider catalog cannot be listed', async () => {
    const { ctx } = await setup({
    }, { routes: [{ id: 'broken', name: 'Broken', models: [], error: 'catalog boom' }] })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      provider: 'broken',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('could not list models')
    expect(text(result)).toContain('catalog boom')
  })

  it('fails when the provider advertises no models', async () => {
    const { ctx } = await setup({}, { routes: [{ id: 'empty', name: 'Empty', models: [] }] })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      provider: 'empty',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('advertises no models')
  })

  it('escalates once to the next tier after a failed foreground run', async () => {
    const { ctx, provider } = await setup({}, { routes: AUTO_ROUTES })
    provider.failFirstCount = 1
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      provider: 'deepseek-official',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(false)
    expect(provider.starts).toHaveLength(2)
    expect(provider.starts[0]!.agentOptions.model).toBe('deepseek-v4-flash')
    expect(provider.starts[1]!.agentOptions.model).toBe('deepseek-v4-std')
    expect(text(result)).toContain('child says hi')
    expect(text(result)).toContain('escalated from deepseek-v4-flash')
  })

  it('reports when the escalated retry also fails', async () => {
    const { ctx, provider } = await setup({}, { routes: AUTO_ROUTES })
    provider.failFirstCount = 2
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      provider: 'deepseek-official',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(true)
    expect(provider.starts).toHaveLength(2)
    expect(text(result)).toContain('subagent run failed after 2 attempt(s)')
    expect(text(result)).toContain('attempt 1 on "deepseek-v4-flash"')
    expect(text(result)).toContain('attempt 2 on "deepseek-v4-std"')
  })

  it('does not escalate when autoEscalate is disabled', async () => {
    const { ctx, provider } = await setup({ autoEscalate: false }, { routes: AUTO_ROUTES })
    provider.failFirstCount = 1
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      provider: 'deepseek-official',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(true)
    expect(provider.starts).toHaveLength(1)
    expect(text(result)).toContain('subagent run failed')
  })

  it('anchors to the parent model for trivial tasks on the parent route', async () => {
    const { ctx, provider } = await setup({}, { routes: AUTO_ROUTES })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentOnPro)
    expect(result.isError).toBe(false)
    expect(provider.starts[0]!.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(text(result)).toContain('[auto] provider=deepseek-official model=deepseek-v4-pro tier=trivial anchored')
    expect(text(result)).toContain("defaulted to the parent's own model")
  })

  it('upgrades from a weak parent model when the task is heavy', async () => {
    const { ctx, provider } = await setup({}, { routes: AUTO_ROUTES })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'deep code review',
      prompt: '```ts\nfunction f() { return 1 }\n```\nAnalyze this code, design a refactor, and evaluate the complexity tradeoffs in depth.',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(false)
    expect(provider.starts[0]!.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(text(result)).toContain('upgraded from the parent')
  })

  it('keeps a strong parent model even for heavy tasks', async () => {
    const { ctx, provider } = await setup({}, { routes: AUTO_ROUTES })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'deep code review',
      prompt: '```ts\nfunction f() { return 1 }\n```\nAnalyze this code, design a refactor, and evaluate the complexity tradeoffs in depth.',
      model: 'auto',
    }, fakeAgentOnPro)
    expect(result.isError).toBe(false)
    expect(provider.starts[0]!.agentOptions).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-pro' })
    expect(text(result)).toContain('anchored')
  })

  it('does not downgrade when escalating from an anchored strong parent model', async () => {
    const { ctx, provider } = await setup({}, { routes: AUTO_ROUTES })
    provider.failFirstCount = 1
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentOnPro)
    expect(result.isError).toBe(true)
    expect(provider.starts).toHaveLength(1)
    expect(text(result)).toContain('subagent run failed')
  })

  it('escalates from an anchored weak parent model to the next tier', async () => {
    const { ctx, provider } = await setup({}, { routes: AUTO_ROUTES })
    provider.failFirstCount = 1
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(false)
    expect(provider.starts).toHaveLength(2)
    expect(provider.starts[0]!.agentOptions.model).toBe('deepseek-v4-flash')
    expect(provider.starts[1]!.agentOptions.model).toBe('deepseek-v4-std')
    expect(text(result)).toContain('escalated from deepseek-v4-flash')
  })
})

describe('dsh-subagent-router failure classification', () => {
  it('classifies LlmError codes into stable classes', () => {
    const quota = new LlmError('quota exhausted', 'QUOTA', { status: 402 })
    const rate = new LlmError('too many requests', 'RATE_LIMIT', { status: 429 })
    const auth = new LlmError('bad key', 'AUTH', { status: 401 })
    const context = new LlmError('context too big', 'CONTEXT_WINDOW_EXCEEDED', { status: 400 })
    const server = new LlmError('server boom', 'SERVER', { status: 503 })
    expect(classifyFailure(quota)).toBe('quota')
    expect(classifyFailure(rate)).toBe('rate-limit')
    expect(classifyFailure(auth)).toBe('auth')
    expect(classifyFailure(context)).toBe('context')
    expect(classifyFailure(server)).toBe('server')
  })

  it('classifies from HTTP status alone when the code is unknown', () => {
    const generic429 = Object.assign(new Error('nope'), { status: 429 })
    const generic401 = Object.assign(new Error('nope'), { status: 401 })
    const generic503 = Object.assign(new Error('nope'), { status: 503 })
    expect(classifyFailure(generic429)).toBe('rate-limit')
    expect(classifyFailure(generic401)).toBe('auth')
    expect(classifyFailure(generic503)).toBe('server')
  })

  it('walks the cause chain and AggregateError members', () => {
    const wrapped = new Error('outer', { cause: new LlmError('rate limited', 'RATE_LIMIT', { status: 429 }) })
    expect(classifyFailure(wrapped)).toBe('rate-limit')
    const aggregate = new AggregateError([new LlmError('quota', 'QUOTA', { status: 402 })], 'agg')
    expect(classifyFailure(aggregate)).toBe('quota')
  })

  it('classifies unknown failures as other without guessing', () => {
    expect(classifyFailure(new Error('random failure'))).toBe('other')
    expect(classifyFailure(undefined)).toBe('other')
  })

  it('classifies quota wording via the harness text classifier', () => {
    expect(classifyFailure(new Error('Insufficient Balance'))).toBe('quota')
    expect(classifyFailure(new Error('You have exceeded your current quota'))).toBe('quota')
  })

  it('renders sanitized bounded failure detail', () => {
    const detail = sanitizeFailureDetail(new LlmError('rate limited', 'RATE_LIMIT', { status: 429 }))
    expect(detail).toContain('rate limited')
    expect(detail.length).toBeLessThanOrEqual(500)
    expect(failureLabel('quota')).toBe('provider quota exhausted')
    expect(failureLabel('rate-limit')).toBe('provider rate-limited')
  })
})

describe('dsh-subagent-router route health store', () => {
  it('reports healthy before any observation and after transient expiry', () => {
    vi.useFakeTimers()
    const store = new RouteHealthStore()
    expect(store.isHealthy('a')).toBe(true)
    store.record('a', 'rate-limit')
    expect(store.isHealthy('a')).toBe(false)
    expect(store.health('a').failingClass).toBe('rate-limit')
    vi.advanceTimersByTime(DEFAULT_TRANSIENT_TTL_MS + 1000)
    expect(store.isHealthy('a')).toBe(true)
    vi.useRealTimers()
  })

  it('treats quota/auth as terminal (never expires)', () => {
    vi.useFakeTimers()
    const store = new RouteHealthStore()
    store.record('a', 'quota')
    expect(store.isHealthy('a')).toBe(false)
    expect(store.health('a').retryAfterSec).toBeUndefined()
    vi.advanceTimersByTime(DEFAULT_TRANSIENT_TTL_MS * 10)
    expect(store.isHealthy('a')).toBe(false)
    vi.useRealTimers()
  })

  it('treats unclassified other failures as transient route-failure signals', () => {
    vi.useFakeTimers()
    const store = new RouteHealthStore()
    store.record('a', 'other')
    // 'other' marks the route unhealthy for the transient TTL...
    expect(store.isHealthy('a')).toBe(false)
    expect(store.health('a').failingClass).toBe('other')
    expect(store.health('a').retryAfterSec).toBeDefined()
    // ...then expires.
    vi.advanceTimersByTime(DEFAULT_TRANSIENT_TTL_MS + 1000)
    expect(store.isHealthy('a')).toBe(true)
    vi.useRealTimers()
  })

  it('clear drops observations', () => {
    const store = new RouteHealthStore()
    store.record('a', 'quota')
    store.clear('a')
    expect(store.isHealthy('a')).toBe(true)
  })
})

describe('dsh-subagent-router health-aware auto routing', () => {
  const MULTI_ROUTES = [
    {
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
        { id: 'deepseek-v4-std', name: 'DeepSeek V4 Std' },
        { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      ],
    },
    {
      id: 'pi-ai-cn',
      name: 'PI AI CN',
      models: [
        { id: 'pi-3-mini', name: 'PI 3 Mini' },
        { id: 'pi-3-maxi', name: 'PI 3 Maxi' },
      ],
    },
  ]

  it('dead anchor: drops the parent route after a quota failure and reroutes to a healthy provider', async () => {
    const { ctx, provider } = await setup({}, { routes: MULTI_ROUTES })
    // First call: parent on deepseek-official, provider rejects with quota.
    provider.rejectFirstCount = 1
    provider.rejectCause = new LlmError('quota exhausted', 'QUOTA', { status: 402 })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    // Terminal class → reroute to the healthy pi-ai-cn provider.
    expect(result.isError).toBe(false)
    expect(provider.starts).toHaveLength(2)
    const first = provider.starts[0]!.agentOptions as { provider?: string; model?: string }
    const second = provider.starts[1]!.agentOptions as { provider?: string; model?: string }
    expect(first).toEqual({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(second.provider).toBe('pi-ai-cn')
    expect(text(result)).toContain('rerouted from deepseek-official')
    expect(text(result)).toContain('provider quota exhausted')
  })

  it('reroute honors autoTierPolicy on the healthy target provider', async () => {
    const { ctx, provider } = await setup(
      // trivial heuristic picks cheapest (deepseek-v4-flash), but the policy
      // says strongest — the reroute to pi-ai-cn must honor it (pi-3-maxi).
      { autoTierPolicy: { trivial: 'strongest' } },
      { routes: MULTI_ROUTES },
    )
    provider.rejectFirstCount = 1
    provider.rejectCause = new LlmError('quota exhausted', 'QUOTA', { status: 402 })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(false)
    expect(provider.starts).toHaveLength(2)
    // First start on deepseek-official (strongest per policy) fails with
    // quota; reroute to the healthy pi-ai-cn picks ITS strongest model.
    const first = provider.starts[0]!.agentOptions as { provider?: string; model?: string }
    const second = provider.starts[1]!.agentOptions as { provider?: string; model?: string }
    expect(first.provider).toBe('deepseek-official')
    expect(first.model).toBe('deepseek-v4-pro')
    expect(second.provider).toBe('pi-ai-cn')
    expect(second.model).toBe('pi-3-maxi')
  })

  it('dead anchor: a second auto call on the unhealthy parent route skips the anchor', async () => {
    const { ctx, provider } = await setup({}, { routes: MULTI_ROUTES })
    // Call 1 fails with quota (records deepseek-official unhealthy).
    provider.rejectFirstCount = 1
    provider.rejectCause = new LlmError('quota exhausted', 'QUOTA', { status: 402 })
    const first = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(first.isError).toBe(false)
    // Call 2: same parent, but the anchor route is now unhealthy — pick
    // pi-ai-cn directly (no failure needed).
    provider.rejectFirstCount = 0
    const second = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(second.isError).toBe(false)
    const options = provider.starts[provider.starts.length - 1]!.agentOptions as { provider?: string; model?: string }
    expect(options.provider).toBe('pi-ai-cn')
    expect(text(second)).toContain('rerouted from deepseek-official')
  })

  it('transient failure escalates on the same provider instead of rerouting', async () => {
    const { ctx, provider } = await setup({}, { routes: MULTI_ROUTES })
    provider.failFirstCount = 1 // stopReason 'error' → classified 'other' → transient
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(false)
    expect(provider.starts).toHaveLength(2)
    const first = provider.starts[0]!.agentOptions as { model?: string }
    const second = provider.starts[1]!.agentOptions as { model?: string }
    expect(first.model).toBe('deepseek-v4-flash')
    expect(second.model).toBe('deepseek-v4-std')
    expect(text(result)).toContain('escalated from deepseek-v4-flash')
    expect(text(result)).not.toContain('rerouted')
  })

  it('climbs the escalation ladder when autoEscalationTiers allows more than one step', async () => {
    const { ctx, provider } = await setup({ autoEscalationTiers: 2 }, { routes: MULTI_ROUTES })
    // Two transient failures: flash (tier trivial) then std (tier standard),
    // third attempt on pro succeeds.
    provider.failFirstCount = 2
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(false)
    expect(provider.starts).toHaveLength(3)
    const models = provider.starts.map(entry => (entry.agentOptions as { model?: string }).model)
    expect(models).toEqual(['deepseek-v4-flash', 'deepseek-v4-std', 'deepseek-v4-pro'])
    expect(text(result)).toContain('escalated from deepseek-v4-std')
    expect(text(result)).toContain('model=deepseek-v4-pro')
  })

  it('stops climbing when an escalated attempt hits a terminal failure', async () => {
    const { ctx, provider } = await setup({ autoEscalationTiers: 2 }, { routes: MULTI_ROUTES })
    // Attempt 1 (flash): transient stopReason 'error'. Attempt 2 (std):
    // reject with quota — escalation must stop there, no third attempt.
    provider.failFirstCount = 1
    provider.rejectAtIndex = [1]
    provider.rejectCause = new LlmError('quota exhausted', 'QUOTA', { status: 402 })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(true)
    // flash (fail) + std (quota) — no pro attempt.
    expect(provider.starts).toHaveLength(2)
    expect(text(result)).toContain('quota exhausted')
  })

  it('does not reroute when autoReroute is disabled', async () => {
    const { ctx, provider } = await setup({ autoReroute: false }, { routes: MULTI_ROUTES })
    provider.rejectFirstCount = 1
    provider.rejectCause = new LlmError('quota exhausted', 'QUOTA', { status: 402 })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(true)
    expect(provider.starts).toHaveLength(1)
    expect(text(result)).toContain('quota exhausted')
    expect(text(result)).not.toContain('rerouted')
  })

  it('surfaces a reroute failure instead of silently falling back', async () => {
    // The healthy target provider's catalog cannot be listed — the reroute
    // must surface why, not silently return the original error alone.
    const { ctx, provider } = await setup({}, {
      routes: [
        {
          id: 'deepseek-official',
          name: 'DeepSeek',
          models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
        },
        {
          id: 'pi-ai-cn',
          name: 'PI AI CN',
          models: [],
          error: 'catalog unavailable',
        },
      ],
    })
    provider.rejectFirstCount = 1
    provider.rejectCause = new LlmError('quota exhausted', 'QUOTA', { status: 402 })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('reroute')
    expect(text(result)).toContain('catalog unavailable')
  })

  it('surfaces sanitized infrastructure failure detail with the failure class', async () => {
    const { ctx, provider } = await setup({}, { routes: MULTI_ROUTES })
    provider.rejectFirstCount = 1
    provider.rejectCause = new LlmError('rate limit exceeded, retry later', 'RATE_LIMIT', { status: 429 })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(true)
    // autoEscalationTiers=1: one escalation attempt, but it also fails
    // (rejectFirstCount applies to every start). The summary names the class.
    expect(text(result)).toContain('provider rate-limited')
    expect(text(result)).toContain('429')
  })

  it('catalog tool annotates unhealthy routes', async () => {
    const { ctx, provider } = await setup({}, { routes: MULTI_ROUTES })
    provider.rejectFirstCount = 1
    provider.rejectCause = new LlmError('quota exhausted', 'QUOTA', { status: 402 })
    await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    const catalog = await callTool(ctx, 'subagent_models', {})
    expect(catalog.isError).toBe(false)
    const value = JSON.parse(text(catalog)) as {
      providers: Array<{
        provider: string
        health?: string
        failingClass?: string
        retryAfterSec?: number
      }>
    }
    const deepseek = value.providers.find(entry => entry.provider === 'deepseek-official')
    expect(deepseek?.health).toBe('unhealthy')
    expect(deepseek?.failingClass).toBe('quota')
    const pi = value.providers.find(entry => entry.provider === 'pi-ai-cn')
    expect(pi?.health).toBe('healthy')
  })

  it('dead anchor: a model-layer stopReason error also marks the route unhealthy', async () => {
    const { ctx, provider } = await setup({}, { routes: MULTI_ROUTES })
    // Call 1: the child's run settles with stopReason 'error' (no cause —
    // the model/transport layer). This records 'other' as a transient
    // route-failure signal; the NEXT auto call must not re-anchor here.
    provider.failFirstCount = 1
    const first = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    // First call: run fails (other), then escalates once to std — success.
    expect(first.isError).toBe(false)
    // Call 2: same parent route, no failure configured — but the route is
    // transiently unhealthy from call 1, so auto must pick pi-ai-cn instead
    // of re-anchoring on deepseek-official.
    provider.failFirstCount = 0
    const second = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(second.isError).toBe(false)
    const options = provider.starts[provider.starts.length - 1]!.agentOptions as { provider?: string; model?: string }
    expect(options.provider).toBe('pi-ai-cn')
    expect(text(second)).toContain('rerouted from deepseek-official')
  })
})

describe('dsh-subagent-router configurable auto routing', () => {
  const PRIORITY_ROUTES = [
    {
      id: 'provider-a',
      name: 'Provider A',
      models: [{ id: 'a-cheap', name: 'A Cheap' }, { id: 'a-pro', name: 'A Pro' }],
    },
    {
      id: 'provider-b',
      name: 'Provider B',
      models: [{ id: 'b-cheap', name: 'B Cheap' }, { id: 'b-pro', name: 'B Pro' }],
    },
  ]

  it('autoProviderOrder picks the first healthy provider when the parent route is absent', async () => {
    const { ctx, provider } = await setup(
      { autoProviderOrder: ['provider-b', 'provider-a'] },
      { routes: PRIORITY_ROUTES },
    )
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgent) // no parent route
    expect(result.isError).toBe(false)
    const options = provider.starts[0]!.agentOptions as { provider?: string; model?: string }
    expect(options.provider).toBe('provider-b')
    // trivial tier → cheapest pick on the chosen provider.
    expect(options.model).toBe('b-cheap')
    expect(text(result)).toContain('provider-b')
  })

  it('autoTierPolicy.cheapest forces the cheapest model even when the parent model is available', async () => {
    const { ctx, provider } = await setup(
      { autoTierPolicy: { trivial: 'cheapest' } },
      { routes: AUTO_ROUTES },
    )
    // Parent on deepseek-v4-pro (strong) — but cheapest policy overrides.
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentOnPro)
    expect(result.isError).toBe(false)
    const options = provider.starts[0]!.agentOptions as { provider?: string; model?: string }
    expect(options.model).toBe('deepseek-v4-flash')
    expect(text(result)).toContain('policy=cheapest')
  })

  it('autoTierPolicy.strongest forces the strongest model for a tier', async () => {
    const { ctx, provider } = await setup(
      { autoTierPolicy: { standard: 'strongest' } },
      { routes: AUTO_ROUTES },
    )
    // ~200 chars: classified 'standard' (past the 160 trivial threshold,
    // below the 1200 complex threshold), no heavy markers or reasoning verbs.
    const result = await callTool(ctx, 'subagent_model', {
      description: 'a standard-length task',
      prompt: 'Go through this dataset and list the main trends and outliers you notice, then write up a short summary of what stands out. Keep it ordinary and mid-length, past the trivial threshold but nowhere near the heavier cutoff, so this task lands in the middle tier for the test.',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(false)
    const options = provider.starts[0]!.agentOptions as { provider?: string; model?: string }
    expect(options.model).toBe('deepseek-v4-pro')
    expect(text(result)).toContain('policy=strongest')
  })

  it('autoTierPicks overrides with an explicit candidate order', async () => {
    const { ctx, provider } = await setup(
      { autoTierPicks: { trivial: ['deepseek-v4-pro', 'deepseek-v4-std'] } },
      { routes: AUTO_ROUTES },
    )
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      provider: 'deepseek-official',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(false)
    const options = provider.starts[0]!.agentOptions as { provider?: string; model?: string }
    expect(options.model).toBe('deepseek-v4-pro')
    expect(text(result)).toContain('policy=picks')
  })

  it('autoTierPicks falls back to the next layer when the candidate is not in the catalog', async () => {
    const { ctx, provider } = await setup(
      { autoTierPicks: { trivial: ['ghost-model'] } },
      { routes: AUTO_ROUTES },
    )
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      provider: 'deepseek-official',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(false)
    const options = provider.starts[0]!.agentOptions as { provider?: string; model?: string }
    // ghost-model not in catalog → falls back to heuristic (trivial → cheapest).
    expect(options.model).toBe('deepseek-v4-flash')
  })

  it('autoCeiling caps the strongest pick', async () => {
    const { ctx, provider } = await setup(
      { autoCeiling: 'deepseek-v4-std' },
      { routes: AUTO_ROUTES },
    )
    const result = await callTool(ctx, 'subagent_model', {
      description: 'deep code review',
      prompt: '```ts\nfunction f() { return 1 }\n```\nAnalyze this code, design a refactor, and evaluate the complexity tradeoffs in depth.',
      provider: 'deepseek-official',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(false)
    const options = provider.starts[0]!.agentOptions as { provider?: string; model?: string }
    expect(options.model).toBe('deepseek-v4-std')
    expect(text(result)).toContain('autoCeiling')
  })

  it('autoTierPicks can cross provider boundaries', async () => {
    const { ctx, provider } = await setup(
      {
        autoProviderOrder: ['provider-a', 'provider-b'],
        // b-pro only exists on provider-b — the local provider-a catalog
        // cannot satisfy it, so the pick must cross to provider-b.
        autoTierPicks: { trivial: ['b-pro'] },
      },
      { routes: PRIORITY_ROUTES },
    )
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgent) // no parent route
    expect(result.isError).toBe(false)
    const options = provider.starts[0]!.agentOptions as { provider?: string; model?: string }
    expect(options.provider).toBe('provider-b')
    expect(options.model).toBe('b-pro')
    expect(text(result)).toContain('policy=picks')
  })

  it('cross-provider picks still resolve when the target catalog cannot be listed', async () => {
    const { ctx, provider } = await setup(
      {
        autoProviderOrder: ['provider-a', 'provider-b'],
        // b-pro only exists on provider-b; provider-b's catalog listing
        // fails — the pick must still resolve (no ladder, no crash).
        autoTierPicks: { trivial: ['b-pro'] },
      },
      {
        routes: [
          {
            id: 'provider-a',
            name: 'Provider A',
            models: [{ id: 'a-cheap', name: 'A Cheap' }, { id: 'a-pro', name: 'A Pro' }],
          },
          {
            id: 'provider-b',
            name: 'Provider B',
            models: [],
            error: 'catalog boom',
          },
        ],
      },
    )
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgent)
    // provider-b is the only one carrying b-pro, but its catalog listing
    // fails — pickFromOrderedAcrossProviders skips it, and no healthy
    // alternative carries the candidate, so the pick falls through. The call
    // should still succeed on provider-a (heuristic), not crash.
    expect(result.isError).toBe(false)
    const options = provider.starts[0]!.agentOptions as { provider?: string; model?: string }
    expect(options.provider).toBe('provider-a')
  })
})

describe('dsh-subagent-router configurable auto routing (edge cases)', () => {
  it('autoCeiling is ignored when the ceiling model is not in the catalog', async () => {
    const { ctx, provider } = await setup(
      { autoCeiling: 'ghost-ceiling' },
      { routes: AUTO_ROUTES },
    )
    const result = await callTool(ctx, 'subagent_model', {
      description: 'deep code review',
      prompt: '```ts\nfunction f() { return 1 }\n```\nAnalyze this code, design a refactor, and evaluate the complexity tradeoffs in depth.',
      provider: 'deepseek-official',
      model: 'auto',
    }, fakeAgent)
    expect(result.isError).toBe(false)
    const options = provider.starts[0]!.agentOptions as { model?: string }
    // ghost-ceiling not in catalog → no cap, strongest pick stands.
    expect(options.model).toBe('deepseek-v4-pro')
    expect(text(result)).not.toContain('autoCeiling')
  })

  it('autoTierPolicy.anchor keeps the parent model when the route is healthy', async () => {
    const { ctx, provider } = await setup(
      { autoTierPolicy: { trivial: 'anchor' } },
      { routes: AUTO_ROUTES },
    )
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentOnPro) // parent on deepseek-v4-pro
    expect(result.isError).toBe(false)
    const options = provider.starts[0]!.agentOptions as { model?: string }
    expect(options.model).toBe('deepseek-v4-pro')
    expect(text(result)).toContain('policy=anchor')
    expect(text(result)).toContain('anchored')
  })
})

describe('dsh-subagent-router config schema', () => {
  it('schema defaults match resolveConfig defaults (dual-source sync, live fields only)', async () => {
    const { Config } = await import('../src/config.ts')
    const { resolveConfig, defaultConfig } = await import('../src/index.ts')
    const fromSchema = Config(undefined)
    const fromResolve = resolveConfig({})
    expect(fromSchema.autoEscalate).toBe(fromResolve.autoEscalate)
    expect(fromSchema.autoReroute).toBe(fromResolve.autoReroute)
    expect(fromSchema.autoEscalationTiers).toBe(fromResolve.autoEscalationTiers)
    expect(fromSchema.autoProviderOrder ?? []).toEqual(fromResolve.autoProviderOrder ?? [])
    // Registration-time knobs are fixed constants, not config fields — verify
    // the fixed defaults match the harness-native subagent semantics.
    const { fixedConfig } = await import('../src/config.ts')
    expect(fixedConfig.subagentProvider).toBe('spawn')
    expect(fixedConfig.backgroundMode).toBe('continuable')
    expect(fixedConfig.maxDepth).toBe('provider-managed')
    expect(fixedConfig.enableRunInBackground).toBe(true)
    expect(fixedConfig.enableAuto).toBe(true)
    expect(fixedConfig.enableModelList).toBe(true)
    expect(defaultConfig.autoEscalationTiers).toBe(1)
  })

  it('schema accepts partial tier config', async () => {
    const { Config } = await import('../src/config.ts')
    const partial = Config({ autoTierPolicy: { trivial: 'cheapest' } })
    expect(partial.autoTierPolicy).toEqual({ trivial: 'cheapest' })
    expect(partial.autoProviderOrder).toEqual([])
  })

  it('schema accepts full live config and rejects unknown snapshot fields', async () => {
    const { Config } = await import('../src/config.ts')
    const full = Config({
      autoProviderOrder: ['a', 'b'],
      autoTierPolicy: { trivial: 'cheapest', standard: 'anchor', complex: 'strongest' },
      autoTierPicks: { complex: ['x'] },
      autoCeiling: 'pro',
      autoEscalationTiers: 2,
    })
    expect(full.autoProviderOrder).toEqual(['a', 'b'])
    expect(full.autoTierPolicy).toEqual({ trivial: 'cheapest', standard: 'anchor', complex: 'strongest' })
    expect(full.autoTierPicks.complex).toEqual(['x'])
    expect(full.autoCeiling).toBe('pro')
    expect(full.autoEscalationTiers).toBe(2)
    // Schemastery passes unknown keys through; registration-time snapshot keys
    // (backgroundMode, toolName, …) are simply never consumed — the fixed
    // behavior comes from `fixedConfig`, so a leftover `backgroundMode` write
    // in a composition entry is inert instead of silently changing behavior.
    const withSnapshot = Config({ backgroundMode: 'one-shot' } as never)
    expect(withSnapshot.backgroundMode).toBe('one-shot')  // passthrough, inert
  })
})

describe('dsh-subagent-router host settings integration', () => {
  /** Minimal settings service: register returns a scope whose `get` reads a
   *  mutable section merged over the schema defaults; external `setSection`
   *  updates it and fires watchers (the settings user-layer write path). */
  function fakeSettingsService() {
    let section: Record<string, unknown> = {}
    const watchers = new Set<() => void>()
    const schemas = new Map<string, { defaults: Record<string, unknown> }>()
    const service = {
      register(ns: string, schema: { defaults?: Record<string, unknown> }, options: { base?: object } = {}) {
        schemas.set(ns, { defaults: (schema as { defaults?: Record<string, unknown> }).defaults ?? {} })
        const scope = {
          get() {
            return { ...schemas.get(ns)!.defaults, ...options.base, ...section }
          },
          watch(cb: () => void) {
            watchers.add(cb)
            return () => watchers.delete(cb)
          },
          update(patch: object) {
            section = { ...section, ...patch }
            for (const cb of watchers) cb()
          },
        }
        return scope
      },
      describe() { return [] },
      get(_ns: string) { return undefined },
    }
    return { service, setSection: (patch: object) => { section = { ...section, ...patch }; for (const cb of watchers) cb() } }
  }

  it('reads configuration from the settings scope when the service is present', async () => {
    const { service, setSection } = fakeSettingsService()
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    ctx.provide('llm', fakeLlm(AUTO_ROUTES))
    const provider = new ScriptedProvider('spawn')
    ctx.subagents.registerProvider(provider)
    ctx.provide('settings', service as never)
    await ctx.plugin(plugin)
    // Default (no user layer): trivial → heuristic pick (cheapest flash).
    let result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(false)
    expect((provider.starts[0]!.agentOptions as { model?: string }).model).toBe('deepseek-v4-flash')
    // Settings write: force trivial → strongest. The tool must pick v4-pro
    // WITHOUT re-registration (responsive config).
    setSection({ autoTierPolicy: { trivial: 'strongest' } })
    result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(false)
    expect((provider.starts[provider.starts.length - 1]!.agentOptions as { model?: string }).model).toBe('deepseek-v4-pro')
    expect(text(result)).toContain('policy=strongest')
  })

  it('falls back to the composition entry when no settings service exists', async () => {
    const { ctx, provider } = await setup({ autoTierPolicy: { trivial: 'strongest' } }, { routes: AUTO_ROUTES })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'say hi',
      prompt: 'hi',
      model: 'auto',
    }, fakeAgentWithRoute)
    expect(result.isError).toBe(false)
    expect((provider.starts[0]!.agentOptions as { model?: string }).model).toBe('deepseek-v4-pro')
    expect(text(result)).toContain('policy=strongest')
  })
})
