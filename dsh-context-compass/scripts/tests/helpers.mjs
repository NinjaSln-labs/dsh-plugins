/**
 * dsh-context-compass — shared smoke-test harness + fixtures.
 *
 * Extracted verbatim from the former monolithic scripts/smoke.mjs. Node ESM
 * modules are singletons per process: every domain file importing this module
 * shares one `check()` runner, one `failures` counter and one set of stub
 * services — exactly the module-level state the monolith relied on.
 *
 * Fixture definition order below mirrors the original file's top-to-bottom
 * order so internal dependencies (tool ← ctx+config, cmdDef ← ctx+config,
 * assertWireSafe ← schema …) hold.
 */
import assert from 'node:assert/strict'
import { sessionHealthProjectionSchema } from '../../lib/schemas.js'
import { sessionHealthProjectionDefinition, applyHealthEvent } from '../../lib/projection.js'
import { healthCommandDefinition } from '../../lib/command.js'
import { sessionHealthTool } from '../../lib/tool.js'
import { resolveConfig } from '../../lib/config.js'

/* ---------- check runner (verbatim from the monolith) ---------- */
export const results = { failures: 0 }
export async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    results.failures++
    console.error(`FAIL  ${name}\n      ${err.message}`)
  }
}

/* ---------- projection fold fixtures (monolith L65-83) ---------- */
export const config = resolveConfig({})
// Economy floor isolated: fold scenarios stay under 50K so ratio tiers show.
export const ratioConfig = resolveConfig({ thresholds: { economyTokenFloor: 10_000_000 } })
export const fold = sessionHealthProjectionDefinition(ratioConfig)
export let state = fold.init()
export const events = [
  { type: 'request/context', data: { contextWindow: 100_000 } },
  { type: 'step/end', data: { turn: 1 } },
  { type: 'step/end', data: { turn: 1 } }, // same turn: must not double count
  { type: 'user/message', data: {} },
  { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 60_000, outputTokens: 500, cacheReadTokens: 300_000 } } },
  { type: 'step/end', data: { turn: 2 } },
  { type: 'user/message', data: {} },
  { type: 'assistant/message', data: { turn: 2, step: 1 } },
  { type: 'compaction/end', data: {} },
  { type: 'assistant/chunk', data: { turn: 2, step: 1, chunk: { type: 'usage', usage: { inputTokens: 32_000, cacheReadTokens: 0 } } } },
]
for (const e of events) state = applyHealthEvent(state, e)

/* ---------- assess() core fixtures (monolith L298-336) ---------- */
export const signal = new AbortController().signal
export const session = { header: { cwd: '/tmp/ws' } }
export const queryEvents = [
  { type: 'turn/start', data: {} },
  { type: 'user/message', data: {} },
  { type: 'assistant/message', data: {} },
  { type: 'turn/start', data: {} },
  { type: 'user/message', data: {} },
]
export const services = {
  tokenMeter: { measure: () => ({ totalTokens: 300_000 }) },
  llm: { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) },
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) },
  sessionQuery: { listEvents: async () => queryEvents },
  sandboxPolicy: { workspaceRoot: '/tmp/ws' },
  fs: {
    resolve: async p => p,
    stat: async p => (p === '.git' || p === 'HANDOFF.md' ? {} : undefined),
  },
  subprocess: undefined,
  // Projection snapshot: uncached 300K/round on a 1M window — billable 300K
  // hits the window-scaled economy floor (max(50K, 0.3×1M)), yellow.
  sessionProjections: {
    snapshot: () => ({
      values: {
        sessionHealth: {
          severity: 'yellow', advice: 'a', ratio: 0.3, total: 300_000, window: 1_000_000,
          turns: 2, userMessages: 2, assistantMessages: 1, compactions: 1, compressionRatio: 0.4,
          uncachedInputTokens: 300_000, cacheReadTokens: 0,
          effectivePerRound: 300_000, effectivePerRoundUsd: 0.084, effectivePerRoundCny: null, pricePeriod: null,
        },
        // Core tokenUsage projection — the cache-hit rate's single data source.
        tokenUsage: { uncachedInputTokens: 300_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    }),
  },
}
export const ctx = { get: name => services[name] }

/* ---------- knowledge linkage stubs (monolith L394-434, D2 decoupled) ---------- */
// knowledge.search 依赖 agents.currentInitiator 派生身份；命令上下文无
// initiator，插件用 agents.withInitiator(agent, op) 包裹——stub 里模拟它。
// withInitiator 依赖 this（真实服务用 this.activeInitiatorRuns）——stub 也
// 用 this 状态，回归「插件必须 .call(agents, …) 保留 this」的实机 bug。
export const agentsStub = {
  _inside: false,
  get: () => ({ id: 'agent-1', session: { id: 'agent-1', header: { cwd: '/tmp/ws' } } }),
  withInitiator(agent, op) {
    if (this === undefined || this._inside === undefined) {
      throw new Error('withInitiator called without agents this-binding')
    }
    this._inside = true
    try { return op() } finally { this._inside = false }
  },
}
export const knowledgeHitCtx = {
  get: name => name === 'knowledge'
    ? {
      // knowledge.search 依赖 this（真实服务用 this.readCaller()）——stub
      // 也检查 this，回归「插件必须 .call(knowledge, …) 保留 this」。
      search(...args) {
        if (this === undefined || this.readCaller === undefined) {
          throw new Error('knowledge.search called without service this-binding')
        }
        return this._searchImpl(...args)
      },
      readCaller: () => ({}),
      _searchImpl: async () => ({
        hits: [{
          content: '---\n交接快照（context-compass-handoff-snapshot）\nseverity: red\nrecommendation: danger-zone\ncompacted: 2\ncompression_ratio: 60\nuncommitted: 3\nhandoff_ready: false\ntimestamp: 2026-08-16T10:00:00.000Z',
          createdAt: Date.parse('2026-08-16T10:00:00.000Z'),
          dedupeKey: 'context-compass-handoff-snapshot',
        }],
        degraded: null,
      }),
    }
    : name === 'agents'
      ? agentsStub
      : services[name],
}

/* ---------- git-state stubs (monolith L474-489) ---------- */
export const GIT_OUT = {
  'status --short': ' M a.ts\n?? b.ts\n',
  'log --oneline -1': '166f5ac feat: x\n',
  'status -sb': '## main...origin/main [ahead 2]\n',
}
export const gitCtx = {
  get: name => (name === 'subprocess'
    ? {
      spawn: ({ argv }) => ({
        done: Promise.resolve({ exitCode: 0 }),
        collected: { stdout: { readFrom: () => ({ text: GIT_OUT[argv.slice(1).join(' ')] ?? '' }) } },
      }),
    }
    : services[name]),
}

/* ---------- processes probe stubs (monolith L532-550) ---------- */
export const psOut = { 'status --short': '', 'log --oneline -1': 'x\n', 'status -sb': '## main\n' }
export const psCtx = {
  get: name => (name === 'subprocess'
    ? {
      spawn: ({ argv }) => {
        const key = argv[0] === 'ps' ? 'ps' : `${argv[1]} ${argv[2] ?? ''}`.trim()
        if (key === 'ps') return {
          done: Promise.resolve({ exitCode: 0 }),
          collected: { stdout: { readFrom: () => ({ text: '  123 vite\n  456 node /usr/bin/dsh\n' }) } },
        }
        return {
          done: Promise.resolve({ exitCode: 0 }),
          collected: { stdout: { readFrom: () => ({ text: psOut[key] ?? '' }) } },
        }
      },
    }
    : services[name]),
}

/* ---------- official pricing document stub (monolith L615-629) ---------- */
export const OFFICIAL_DOC = {
  source: 'https://api-docs.deepseek.com/quick_start/pricing/',
  peakHours: [[9, 12], [14, 18]],
  models: {
    'deepseek-v4-flash': {
      peak: { inputMissPerMCny: 3.0, inputHitPerMCny: 0.10, inputMissPerMUsd: 0.44, inputHitPerMUsd: 0.014 },
      offpeak: { inputMissPerMCny: 1.5, inputHitPerMCny: 0.05, inputMissPerMUsd: 0.22, inputHitPerMUsd: 0.007 },
    },
    '*': {
      peak: { inputMissPerMCny: 3.0, inputHitPerMCny: 0.10, inputMissPerMUsd: 0.44, inputHitPerMUsd: 0.014 },
      offpeak: { inputMissPerMCny: 1.5, inputHitPerMCny: 0.05, inputMissPerMUsd: 0.22, inputHitPerMUsd: 0.007 },
    },
  },
}

/* ---------- /compass command handler fixture (monolith L830) ---------- */
export const cmdDef = healthCommandDefinition(ctx, config)

/* ---------- context_compass tool fixture (monolith L915) ---------- */
export const tool = sessionHealthTool(ctx, config)

/* ---------- multi-session overview fixtures (monolith L1090-1136) ---------- */
export const healthOf = (severity, extra = {}) => ({
  severity,
  advice: 'a',
  ratio: null,
  total: null,
  window: null,
  turns: 0,
  userMessages: 0,
  assistantMessages: 0,
  compactions: 0,
  uncachedInputTokens: null,
  cacheReadTokens: null,
  effectivePerRound: null,
  effectivePerRoundUsd: null,
  effectivePerRoundCny: null,
  pricePeriod: null,
  ...extra,
})
export const overviewServices = {
  sessionQuery: {
    listSessions: async () => [
      { header: { id: 'live-red', createdAt: 100 }, live: true, persisted: true },
      { header: { id: 'cold-yellow', createdAt: 300 }, live: false, persisted: true },
      { header: { id: 'cold-unknown', createdAt: 200 }, live: false, persisted: true },
      { header: { id: 'live-green', createdAt: 400 }, live: true, persisted: true },
    ],
    readTitleSnapshots: async ids => ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { title: { title: `T-${id}` } } })),
  },
  sessions: { get: id => (id === 'live-red' || id === 'live-green' ? { header: { id } } : undefined) },
  sessionProjections: {
    snapshot: session => ({
      values: {
        sessionHealth: session.header.id === 'live-red'
          ? healthOf('red', { ratio: 0.9, total: 900_000 })
          : healthOf('green', { ratio: 0.05 }),
      },
    }),
  },
  sessionProjectionCache: {
    cachedSnapshot: meta => meta.id === 'cold-yellow'
      ? { values: { sessionHealth: healthOf('yellow', { ratio: 0.6 }) } }
      : undefined,
    coldSnapshot: async () => undefined, // cold-unknown stays null
  },
  sessionTitle: { get: () => undefined }, // force the batch title path
}
export const overviewCtx = { get: name => overviewServices[name] }

/* ---------- overview RPC req/res stubs (monolith L1370-1382) ---------- */
export function fakeRes() {
  const out = { status: null, headers: null, body: null }
  return {
    out,
    writeHead: (status, headers) => { out.status = status; out.headers = headers },
    end: body => { out.body = body },
  }
}
export function fakeReq(method, body, remoteAddress) {
  // Host header added for the AUDIT OV-3 Host check: loopback RPC now requires
  // a loopback Host (127.0.0.1/localhost/[::1]) to resist DNS rebinding.
  const req = { method, socket: { remoteAddress }, headers: { host: '127.0.0.1:3080' } }
  req[Symbol.asyncIterator] = async function* () { if (body !== undefined) yield body }
  return req
}

/* ---------- S2 wire-safety helper (monolith L1520-1537; shared with R1) ---------- */
const WIRE_NULLABLE_FINITE = [
  'ratio', 'total', 'window', 'compressionRatio', 'uncachedInputTokens',
  'cacheReadTokens', 'effectivePerRound', 'effectivePerRoundUsd', 'effectivePerRoundCny',
]
export function assertWireSafe(view, label) {
  assert.ok(['green', 'blue', 'yellow', 'red'].includes(view.severity), `${label}: severity = ${view.severity}`)
  assert.equal(typeof view.advice, 'string', `${label}: advice type`)
  assert.ok(!view.advice.includes('NaN') && !view.advice.includes('undefined') && !view.advice.includes('null'), `${label}: advice leaks: ${view.advice}`)
  for (const k of WIRE_NULLABLE_FINITE) {
    assert.ok(view[k] === null || (Number.isFinite(view[k]) && view[k] >= 0), `${label}: ${k} = ${view[k]}`)
  }
  for (const k of ['turns', 'userMessages', 'assistantMessages', 'compactions']) {
    assert.ok(Number.isInteger(view[k]) && view[k] >= 0, `${label}: ${k} = ${view[k]}`)
  }
  assert.ok(Array.isArray(view.pressureHistory) && view.pressureHistory.every(Number.isFinite), `${label}: pressureHistory = ${JSON.stringify(view.pressureHistory)}`)
  assert.ok(view.pricePeriod === null || view.pricePeriod === 'peak' || view.pricePeriod === 'offpeak', `${label}: pricePeriod`)
  sessionHealthProjectionSchema.parse(view) // strict schema — 任何漂移在此抛错
}
