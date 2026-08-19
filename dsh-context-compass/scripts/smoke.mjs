/**
 * dsh-context-compass — smoke test.
 *
 * Drives the built lib/ with stub services: projection fold over synthetic
 * events, the shared assess() core, the /compass command handler, and the
 * context_compass tool execute. Run after `npm run build`.
 *
 *   npm run build && npm run smoke
 */
import assert from 'node:assert/strict'
import { sessionHealthProjectionDefinition, applyHealthEvent, healthView } from '../lib/projection.js'
import { cacheHitRateOf } from '../lib/usage.js'
import { assess } from '../lib/assess.js'
import { healthCommandDefinition, buildCommandText } from '../lib/command.js'
import { sessionHealthTool } from '../lib/tool.js'
import { resolveConfig } from '../lib/config.js'
import { PriceCache, periodAt, staticPricing } from '../lib/pricing.js'
import { formatCompact, formatUsd, formatCny, formatHitRate } from '../lib/util.js'
import { buildOverview, sortOverviewRows, rankOf, clearTitleCache, handleOverviewRpc, buildHandoffSummary } from '../lib/overview.js'

let failures = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    failures++
    console.error(`FAIL  ${name}\n      ${err.message}`)
  }
}

await check('util: formatCompact round-overflow guard + scale boundaries', () => {
  assert.equal(formatCompact(999), '999')
  assert.equal(formatCompact(1000), '1K')
  assert.equal(formatCompact(999_499), '999K')  // rounds down
  assert.equal(formatCompact(999_500), '1M')  // round-overflow guard: never 1000K
  assert.equal(formatCompact(999_999), '1M')
  assert.equal(formatCompact(1_000_000), '1M')
  assert.equal(formatCompact(1_234_567), '1.2M')
  assert.equal(formatCompact(10_000_000), '10M')
})

await check('util: money formatting boundaries', () => {
  assert.equal(formatUsd(0.02), '$0.02')
  assert.equal(formatUsd(45), '$45.00')
  assert.equal(formatUsd(99.99), '$99.99')
  assert.equal(formatUsd(100), '$100')
  assert.equal(formatUsd(1234.5), '$1235')
  assert.equal(formatCny(0.1), '¥0.10')
  assert.equal(formatHitRate(0.996), '100%')
})

/* ---------- projection fold ---------- */
const config = resolveConfig({})
// Economy floor isolated: fold scenarios stay under 50K so ratio tiers show.
const ratioConfig = resolveConfig({ thresholds: { economyTokenFloor: 10_000_000 } })
const fold = sessionHealthProjectionDefinition(ratioConfig)
let state = fold.init()
const events = [
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

await check('projection: fold counts (turns/messages/compactions)', () => {
  assert.equal(state.turns, 2)
  assert.equal(state.userMessages, 2)
  assert.equal(state.assistantMessages, 2)
  assert.equal(state.compactions, 1)
  assert.equal(state.pressureTokens, 32_000) // last usage sample wins
  assert.equal(state.contextWindow, 100_000)
})

await check('projection: usage report without inputTokens is skipped (no NaN/0 pollution)', () => {
  const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0, pressureTokens: 360_000 }
  // Streaming chunk usage often omits inputTokens — must NOT overwrite the
  // last good pressure with NaN or 0.
  const chunk = applyHealthEvent(base, { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { outputTokens: 100 } } } })
  assert.equal(chunk.pressureTokens, 360_000)
  assert.equal(chunk.lastUsage, undefined)
  assert.ok(!Number.isNaN(chunk.pressureTokens))
  // Same for assistant/message with an incomplete usage report.
  const msg = applyHealthEvent(base, { type: 'assistant/message', data: { turn: 1, step: 1, usage: { outputTokens: 50 } } })
  assert.equal(msg.pressureTokens, 360_000)
  assert.equal(msg.assistantMessages, 1) // message still counts; usage skipped
  // Complete usage still updates.
  const ok = applyHealthEvent(base, { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 32_000, cacheReadTokens: 0 } } } })
  assert.equal(ok.pressureTokens, 32_000)
  assert.deepEqual(ok.lastUsage, { inputTokens: 32_000, cacheReadTokens: 0, cacheWriteTokens: 0 })
})

await check('projection: compression ratio inferred from pressure snapshots', () => {
  // Pre-compaction pressure was 360K (60K uncached + 300K cacheRead on the
  // first assistant/message); the compaction/end captured it; the first
  // usage sample after the fold (32K) yields 1 − 32/360 ≈ 0.911.
  assert.equal(state.preCompactionPressure, undefined) // consumed by the fold
  assert.ok(state.compressionRatio !== null && Math.abs(state.compressionRatio - (1 - 32_000 / 360_000)) < 1e-9)
  // The view carries the ratio + the snapshot-delta caliber note.
  const view = healthView(state, ratioConfig)
  assert.equal(view.compressionRatio, state.compressionRatio)
  assert.ok(view.advice.includes('上次压缩比例'))
  assert.ok(view.advice.includes('快照口径'))
})

await check('projection: inconclusive fold (no pressure drop) reads null', () => {
  const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
  let s = applyHealthEvent({ ...base, pressureTokens: 50_000 }, { type: 'compaction/end', data: {} })
  s = applyHealthEvent(s, { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 60_000, cacheReadTokens: 0 } } })
  assert.equal(s.compressionRatio, null) // post >= pre: inconclusive, never a fake 0
  assert.equal(s.preCompactionPressure, undefined)
  assert.equal(healthView(s, ratioConfig).compressionRatio, null)
  // No compaction at all → no inference.
  const plain = healthView({ ...base, pressureTokens: 10_000 }, ratioConfig)
  assert.equal(plain.compressionRatio, null)
})

await check('projection: fold keeps last-wins buckets only (rate lives in usage.ts)', () => {
  // The fold no longer accumulates usage totals — the cache-hit rate is read
  // from the core tokenUsage projection via cacheHitRateOf (one algorithm).
  assert.equal(state.usageTotals, undefined)
  assert.equal(state.usageWindow, undefined)
  // Last-request buckets still feed the per-round money math.
  assert.deepEqual(state.lastUsage, { inputTokens: 32_000, cacheReadTokens: 0, cacheWriteTokens: 0 })
})

await check('projection: blue severity at 32% occupancy', () => {
  const view = healthView(state, ratioConfig)
  assert.equal(view.severity, 'blue')
  assert.equal(view.ratio, 0.32)
  assert.ok(view.advice.includes('32%'))
})

await check('projection: severity tiers across thresholds', () => {
  const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
  const viewOf = (pressure, window) => healthView(
    { ...base, ...(pressure !== null ? { pressureTokens: pressure } : {}), ...(window !== null ? { contextWindow: window } : {}) },
    ratioConfig, // economy floor raised: pure ratio tiers
  )
  assert.equal(viewOf(100_000, 1_000_000).severity, 'green')   // 10%
  assert.equal(viewOf(350_000, 1_000_000).severity, 'blue')    // 35%
  assert.equal(viewOf(600_000, 1_000_000).severity, 'yellow')  // 60%
  assert.equal(viewOf(900_000, 1_000_000).severity, 'red')     // 90%
})

await check('projection: economy bills cache-discounted effective per round', () => {
  const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
  const viewOf = (pressure, window, lastUsage) => healthView(
    {
      ...base,
      ...(pressure !== null ? { pressureTokens: pressure } : {}),
      ...(window !== null ? { contextWindow: window } : {}),
      ...(lastUsage !== undefined ? { lastUsage } : {}),
    },
    config,
  )
  // No window: the absolute floor (50K) applies to the billable-equivalent.
  assert.equal(viewOf(60_000, null, { inputTokens: 60_000, cacheReadTokens: 0, cacheWriteTokens: 0 }).severity, 'yellow')
  assert.equal(viewOf(10_000, null, { inputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 }).severity, 'green')
})

await check('projection: economy floor scales with the window (no 15%-yellow)', () => {
  const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
  const viewOf = (pressure, window, lastUsage) => healthView(
    { ...base, ...(pressure !== null ? { pressureTokens: pressure } : {}), ...(window !== null ? { contextWindow: window } : {}), lastUsage },
    config,
  )
  // 1M window → economy floor = max(50K, 0.3 × 1M) = 300K billable-equivalent.
  // The old 50K floor fired at 10% occupancy; now 15% stays green (cached or not).
  assert.equal(
    viewOf(100_000, 1_000_000, { inputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 }).severity,
    'green', // 10% occupancy, billable 100K < 300K
  )
  assert.equal(
    viewOf(150_000, 1_000_000, { inputTokens: 15_000, cacheReadTokens: 135_000, cacheWriteTokens: 0 }).severity,
    'green', // 15% occupancy, 90% cache hit → billable 28.5K < 300K
  )
  // Uncached at 32%: billable 320K ≥ 300K → economy outranks the blue tier.
  const v = viewOf(320_000, 1_000_000, { inputTokens: 320_000, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(v.severity, 'yellow')
  assert.ok(v.advice.includes('已计缓存折扣'))
})

await check('projection: message-count proxy escalates green → blue (window-scaled)', () => {
  // A4：effectiveProxy = max(800, window × 0.002)。1M 窗口 → 2000。
  const base = {
    turns: 40, lastTurn: null, userMessages: 1200, assistantMessages: 1300,
    compactions: 0, pressureTokens: 20_000, contextWindow: 1_000_000,
  }
  const view = healthView(base, config) // 2% occupancy, 2500 messages ≥ 2000 proxy
  assert.equal(view.severity, 'blue')
  assert.ok(view.advice.includes('代理指标'))
  assert.ok(view.advice.includes('2500'))
  // 1M 窗口 1500 消息 < 2000：不触发（旧 800 阈值下会误触发）。
  const mid = healthView({ ...base, userMessages: 700, assistantMessages: 800 }, config)
  assert.equal(mid.severity, 'green')
  // 128K 窗口：effectiveProxy = max(800, 256) = 800 → 1000 消息仍触发。
  const smallWindow = healthView({ ...base, userMessages: 500, assistantMessages: 500, contextWindow: 128_000 }, config)
  assert.equal(smallWindow.severity, 'blue')
})

await check('usage: cacheHitRateOf — single algorithm for every surface', () => {
  // Same formula as the core input-bar stats line (cacheRead / (uncached +
  // cacheRead + cacheWrite)), operating on the core tokenUsage totals.
  assert.ok(Math.abs(cacheHitRateOf({ uncachedInputTokens: 350_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 }) - 500_000 / 850_000) < 1e-9)
  // cacheWrite counts in the denominator, exactly like the core stats line.
  assert.ok(Math.abs(cacheHitRateOf({ uncachedInputTokens: 100_000, cacheReadTokens: 400_000, cacheWriteTokens: 200_000 }) - 400_000 / 700_000) < 1e-9)
  // Nothing billed → null; absent projection → null.
  assert.equal(cacheHitRateOf({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), null)
  assert.equal(cacheHitRateOf(undefined), null)
})

await check('projection: per-round cost math (token + USD) — cacheHitRate no longer carried', () => {
  const state2 = {
    turns: 1, lastTurn: 1, userMessages: 1, assistantMessages: 1, compactions: 0,
    pressureTokens: 550_000, contextWindow: 1_000_000,
    lastUsage: { inputTokens: 50_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 },
  }
  const v = healthView(state2, config) // cacheHitDiscount 0.1, inputPricePerM 0.28
  assert.equal(v.cacheHitRate, undefined) // rate lives in src/usage.ts off the core tokenUsage projection
  assert.equal(v.uncachedInputTokens, 50_000)
  assert.equal(v.cacheReadTokens, 500_000)
  assert.equal(v.effectivePerRound, 50_000 + 500_000 * 0.1) // 100K billable-equivalent
  assert.ok(Math.abs(v.effectivePerRoundUsd - (100_000 * 0.28) / 1_000_000) < 1e-9) // $0.028/轮
  const empty = healthView({ ...state2, lastUsage: undefined }, config)
  assert.equal(empty.effectivePerRound, null)
  assert.equal(empty.effectivePerRoundUsd, null)
})

/* ---------- assess() core ---------- */
const signal = new AbortController().signal
const session = { header: { cwd: '/tmp/ws' } }
const queryEvents = [
  { type: 'turn/start', data: {} },
  { type: 'user/message', data: {} },
  { type: 'assistant/message', data: {} },
  { type: 'turn/start', data: {} },
  { type: 'user/message', data: {} },
]
const services = {
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
const ctx = { get: name => services[name] }

await check('assess: economy yellow + probes + counts', async () => {
  const report = await assess(ctx, session, 'agent-1', signal, config, { docName: 'HANDOFF.md' })
  assert.equal(report.severity, 'yellow') // billable 300K >= max(50K, 0.3×1M) economy floor
  assert.equal(report.signals.turns, 2)
  assert.equal(report.signals.userMessages, 2)
  assert.equal(report.signals.total, 300_000)
  assert.equal(report.handoff.isGitRepo, true)
  assert.equal(report.handoff.hasHandoff, true)
  assert.equal(report.recommendation, 'suggest-switch')
  assert.ok(report.probes.some(p => p.includes('git 仓库')))
  assert.ok(report.probes.some(p => p.includes('交接文档：已就位')))
  assert.ok(report.probes.some(p => p.includes('缓存命中率 0%')))
})

await check('assess: compression ratio rides the fold snapshot + caliber probe', async () => {
  const report = await assess(ctx, session, 'agent-1', signal, config, {})
  assert.equal(report.signals.compactionRatio, 0.4)
  assert.ok(report.probes.some(p => p.includes('上次压缩比例 ≈ 40%') && p.includes('快照口径')))
  const text = buildCommandText(report, { minimal: false })
  assert.ok(text.includes('已压缩 1 次：早期细节概要化（上次压缩比例 ≈ 40%'))
})

await check('assess: danger-zone when work depends on unrecorded early content', async () => {
  const report = await assess(ctx, session, 'agent-1', signal, config, {
    dependsOnEarly: true,
    earlyDecisionRecorded: false,
  })
  assert.equal(report.recommendation, 'danger-zone')
  assert.ok(report.reason.includes('裸切'))
})

await check('assess: minimal skips probes', async () => {
  const report = await assess(ctx, session, 'agent-1', signal, config, { minimal: true })
  assert.ok(!report.probes.some(p => p.includes('git')))
  assert.ok(!report.probes.some(p => p.includes('交接')))
})

/* ---------- knowledge linkage (D2, decoupled) ---------- */
// knowledge.search 依赖 agents.currentInitiator 派生身份；命令上下文无
// initiator，插件用 agents.withInitiator(agent, op) 包裹——stub 里模拟它。
// withInitiator 依赖 this（真实服务用 this.activeInitiatorRuns）——stub 也
// 用 this 状态，回归「插件必须 .call(agents, …) 保留 this」的实机 bug。
const agentsStub = {
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
const knowledgeHitCtx = {
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
await check('knowledge: absent service degrades to a skip probe (no dependency)', async () => {
  const report = await assess(ctx, session, 'agent-1', signal, config, {})
  assert.ok(report.probes.some(p => p.includes('知识库未安装')))
  // 「跨会话回顾已跳过」是跳过行本身；真正的回顾行以「跨会话回顾（」开头。
  assert.ok(!report.probes.some(p => p.includes('跨会话回顾（')))
})

await check('knowledge: cross-session lookback from a mounted service', async () => {
  const report = await assess(knowledgeHitCtx, session, 'agent-1', signal, config, {})
  const note = report.probes.find(p => p.includes('跨会话回顾（'))
  assert.ok(note !== undefined, `expected lookback probe, got: ${JSON.stringify(report.probes)}`)
  assert.ok(note.includes('2026-08-16'))
  assert.ok(note.includes('severity: red'))
})

await check('knowledge: mounted but no resolvable agent → skip, never throws', async () => {
  const noAgentCtx = {
    get: name => name === 'knowledge'
      ? { search: async () => { throw new Error('should not be called') } }
      : name === 'agents'
        ? { get: () => undefined, withInitiator: (_a, op) => op() }
        : services[name],
  }
  const report = await assess(noAgentCtx, session, 'agent-1', signal, config, {})
  assert.ok(report.probes.some(p => p.includes('无法定位 agent 身份')))
})

await check('knowledge: search failure degrades, never throws', async () => {
  const failCtx = {
    get: name => name === 'knowledge'
      ? { search: async () => { throw new Error('boom') } }
      : name === 'agents'
        ? agentsStub
        : services[name],
  }
  const report = await assess(failCtx, session, 'agent-1', signal, config, {})
  assert.ok(report.probes.some(p => p.includes('检索失败')))
})

/* ---------- git-state automation + cost expectation ---------- */
const GIT_OUT = {
  'status --short': ' M a.ts\n?? b.ts\n',
  'log --oneline -1': '166f5ac feat: x\n',
  'status -sb': '## main...origin/main [ahead 2]\n',
}
const gitCtx = {
  get: name => (name === 'subprocess'
    ? {
      spawn: ({ argv }) => ({
        done: Promise.resolve({ exitCode: 0 }),
        collected: { stdout: { readFrom: () => ({ text: GIT_OUT[argv.slice(1).join(' ')] ?? '' }) } },
      }),
    }
    : services[name]),
}
await check('assess: git worktree state automates the handoff checklist', async () => {
  const report = await assess(gitCtx, session, 'agent-1', signal, config, {})
  assert.equal(report.handoff.clean, false)
  assert.equal(report.handoff.uncommittedCount, 2)
  assert.equal(report.handoff.lastCommit, '166f5ac feat: x')
  assert.ok(report.handoff.branchLine.includes('ahead 2'))
  assert.ok(report.probes.some(p => p.includes('git 工作树：2 个未提交变更')))
  const text = buildCommandText(report, { minimal: false })
  assert.ok(text.includes('- [ ] 未提交变更：2 个'))
  assert.ok(text.includes('- [ ] 已 push：## main...origin/main [ahead 2]'))
})

await check('assess: clean worktree marks the commit/push items done', async () => {
  const cleanOut = { ...GIT_OUT, 'status --short': '' }
  const cleanCtx = {
    get: name => (name === 'subprocess'
      ? {
        spawn: ({ argv }) => ({
          done: Promise.resolve({ exitCode: 0 }),
          collected: { stdout: { readFrom: () => ({ text: cleanOut[argv.slice(1).join(' ')] ?? '' }) } },
        }),
      }
      : services[name]),
  }
  const report = await assess(cleanCtx, session, 'agent-1', signal, config, {})
  assert.equal(report.handoff.clean, true)
  assert.equal(report.handoff.uncommittedCount, 0)
  assert.ok(report.probes.some(p => p.includes('git 工作树：干净')))
})

await check('tool: handoffReady surfaces branchLine (push state) from the git probe', async () => {
  // The tool's assess path reads the same subprocess seam as /compass — the
  // push state (ahead/behind) must reach the model through handoffReady.
  const gitTool = sessionHealthTool(gitCtx, config)
  const value = await gitTool.execute({}, {
    agent: { id: 'agent-1', session },
    signal,
  })
  assert.equal(value.handoffReady.branchLine, '## main...origin/main [ahead 2]')
  assert.equal(value.handoffReady.uncommittedCount, 2)
})

/* ---------- processes probe (default OFF, DESIGN §4.6) ---------- */
const psOut = { 'status --short': '', 'log --oneline -1': 'x\n', 'status -sb': '## main\n' }
const psCtx = {
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

await check('assess: processes probe default OFF — /compass does not run ps unless enabled or requested', async () => {
  // DESIGN §4.6: 进程检测默认关闭（config.checks.processes.enabled=false），
  // 「关闭时跳过」。默认 /compass 不探测；显式 processes 参数才探测。
  // 默认（enabled=false）：/compass 不跑 ps → probe 明确标注「已跳过」
  // （与 git/handoff 对称），且无「发现」结果行。
  const report = await assess(psCtx, session, 'agent-1', signal, config, {})
  assert.ok(report.probes.some(p => p.includes('进程检测：已跳过')), `default must note the skip, got: ${JSON.stringify(report.probes)}`)
  assert.ok(!report.probes.some(p => p.includes('进程检测：发现')), `default must not probe, got: ${JSON.stringify(report.probes)}`)
  assert.equal(report.handoff.processesChecked, false)
  // 显式 checkProcesses=true（/compass processes / 工具路径）：探测并回报。
  const withProcs = await assess(psCtx, session, 'agent-1', signal, config, { checkProcesses: true })
  assert.equal(withProcs.handoff.processesChecked, true)
  assert.ok(withProcs.handoff.runningProcesses.length >= 1, `expected a dev-server marker, got: ${JSON.stringify(withProcs.handoff.runningProcesses)}`)
  assert.ok(withProcs.probes.some(p => p.includes('进程检测：发现')))
  // 用户配置 enabled=true：/compass 默认也探测（尊重配置）。
  const enabledCfg = resolveConfig({ checks: { processes: { enabled: true } } })
  const onByConfig = await assess(psCtx, session, 'agent-1', signal, enabledCfg, {})
  assert.ok(onByConfig.probes.some(p => p.includes('进程检测')), `config-enabled must probe, got: ${JSON.stringify(onByConfig.probes)}`)
})

await check('command: explicit processes argument probes even with default OFF', async () => {
  const cmdDef = healthCommandDefinition(psCtx, config)
  const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'processes', signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('进程检测：发现'))
})

await check('assess: cost expectation from cache-effective per-round', async () => {
  const costCtx = {
    get: name => {
      if (name === 'sessionProjections') {
        return {
          snapshot: () => ({
            values: {
              sessionHealth: {
                severity: 'yellow', advice: 'a', ratio: 0.13, total: 132_000, window: 1_000_000,
                turns: 2, userMessages: 2, assistantMessages: 1, compactions: 0,
                uncachedInputTokens: 13_200, cacheReadTokens: 118_800,
                effectivePerRound: 25_080, // 13200 + 118800*0.1
                effectivePerRoundUsd: (25_080 * 0.28) / 1_000_000, // $0.007/轮
              },
              tokenUsage: { uncachedInputTokens: 13_200, cacheReadTokens: 118_800, cacheWriteTokens: 0 },
            },
          }),
        }
      }
      return services[name]
    },
  }
  const report = await assess(costCtx, session, 'agent-1', signal, config, { remainingRounds: 10 })
  assert.equal(report.signals.cacheHitRate, 0.9)
  assert.equal(report.signals.effectivePerRound, 25_080)
  assert.equal(report.signals.expectedTotalTokens, 250_800)
  assert.equal(report.signals.inputPricePerM, 0.28)
  assert.ok(report.signals.effectivePerRoundUsd !== null && Math.abs(report.signals.effectivePerRoundUsd - 0.0070224) < 1e-9)
  assert.ok(report.signals.expectedTotalUsd !== null && Math.abs(report.signals.expectedTotalUsd - 0.070224) < 1e-9)
  assert.ok(report.probes.some(p => p.includes('缓存命中率 90%')))
  const text = buildCommandText(report, { minimal: false })
  assert.ok(text.includes('- 缓存命中率 90%'))
  assert.ok(text.includes('计费预期：约 $0.01/轮'), `got: ${text}`)
  assert.ok(text.includes('剩余轮数输入费用预期 ≈ $0.07（约 251K token 计费当量）'))
})

/* ---------- pricing (official peak/valley document) ---------- */
const OFFICIAL_DOC = {
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

await check('pricing: periodAt follows Beijing wall time', () => {
  const hours = [[9, 12], [14, 18]]
  // 2026-08-14T01:00Z = 09:00 Beijing (peak start, inclusive)
  assert.equal(periodAt(hours, Date.parse('2026-08-14T01:00:00Z')), 'peak')
  // 03:59Z = 11:59 Beijing (still peak)
  assert.equal(periodAt(hours, Date.parse('2026-08-14T03:59:00Z')), 'peak')
  // 04:00Z = 12:00 Beijing (peak over)
  assert.equal(periodAt(hours, Date.parse('2026-08-14T04:00:00Z')), 'offpeak')
  // 08:00Z = 16:00 Beijing (afternoon peak)
  assert.equal(periodAt(hours, Date.parse('2026-08-14T08:00:00Z')), 'peak')
  // 10:00Z = 18:00 Beijing (off-peak)
  assert.equal(periodAt(hours, Date.parse('2026-08-14T10:00:00Z')), 'offpeak')
})

await check('pricing: auto refresh resolves model + period (peak/offpeak prices)', async () => {
  const cache = new PriceCache(staticPricing(0.28, 0.1))
  const fetchImpl = async () => ({ ok: true, json: async () => structuredClone(OFFICIAL_DOC) })
  assert.equal(await cache.refresh('https://x', fetchImpl), true)
  // Peak window (Beijing 9-12): 2026-08-14T01:00Z
  const origNow = Date.now
  Date.now = () => Date.parse('2026-08-14T01:00:00Z')
  try {
    const p = cache.get('deepseek-v4-flash')
    assert.equal(p.missPerMCny, 3.0)
    assert.equal(p.hitPerMCny, 0.10)
    assert.equal(p.missPerMUsd, 0.44)
    assert.equal(p.hitPerMUsd, 0.014)
    assert.equal(p.period, 'peak')
  } finally { Date.now = origNow }
  // Off-peak: 2026-08-14T10:00Z
  Date.now = () => Date.parse('2026-08-14T10:00:00Z')
  try {
    const p = cache.get('deepseek-v4-flash')
    assert.equal(p.missPerMCny, 1.5)
    assert.equal(p.hitPerMCny, 0.05)
    assert.equal(p.missPerMUsd, 0.22)
    assert.equal(p.period, 'offpeak')
    // unknown model falls back to "*"
    assert.equal(cache.get('some-other-model').missPerMCny, 1.5)
  } finally { Date.now = origNow }
})

await check('pricing: failure keeps the last good price', async () => {
  const cache = new PriceCache(staticPricing(0.28, 0.1))
  const ok = async () => ({ ok: true, json: async () => structuredClone(OFFICIAL_DOC) })
  await cache.refresh('https://x', ok)
  const fail = async () => { throw new Error('offline') }
  assert.equal(await cache.refresh('https://x', fail), false)
  // Pin to Beijing off-peak: the get() period is wall-clock dependent, so an
  // assertion on a concrete price must not run during 9-12 / 14-18 CST.
  const origNow = Date.now
  Date.now = () => Date.parse('2026-08-14T10:00:00Z')
  try {
    assert.equal(cache.get().missPerMCny, 1.5) // last good document survives
  } finally { Date.now = origNow }
})

await check('pricing: refreshAny falls back to the second URL', async () => {
  const cache = new PriceCache(staticPricing(0.28, 0.1))
  const fail = async () => { throw new Error('primary down') }
  const ok = async () => ({ ok: true, json: async () => structuredClone(OFFICIAL_DOC) })
  assert.equal(await cache.refreshAny(['https://primary', 'https://fallback'], fail), false) // both down
  assert.equal(cache.get().missPerMCny, null) // static fallback intact
  assert.equal(
    await cache.refreshAny(['https://primary', 'https://fallback'], url => (url.includes('fallback') ? ok() : fail())),
    true,
  )
  // Same off-peak pin as above (peak hours would bill 3.0, not 1.5).
  const origNow = Date.now
  Date.now = () => Date.parse('2026-08-14T10:00:00Z')
  try {
    assert.equal(cache.get('deepseek-v4-flash').missPerMCny, 1.5) // fallback doc won
  } finally { Date.now = origNow }
})

await check('pricing: invalid documents are rejected', async () => {
  const cache = new PriceCache(staticPricing(0.28, 0.1))
  for (const bad of [
    { peakHours: [], models: { '*': OFFICIAL_DOC.models['*'] } },
    { peakHours: [[9, 12]], models: {} },
    { peakHours: [[9, 12]], models: { '*': { peak: { inputMissPerMCny: -1, inputHitPerMCny: 0.1, inputMissPerMUsd: 0.44, inputHitPerMUsd: 0.014 }, offpeak: OFFICIAL_DOC.models['*'].offpeak } } },
    { peakHours: [[9, 12]], models: { '*': { peak: { inputMissPerMCny: 1, inputHitPerMCny: 0.1 }, offpeak: OFFICIAL_DOC.models['*'].offpeak } } },
  ]) {
    const fetchImpl = async () => ({ ok: true, json: async () => bad })
    assert.equal(await cache.refresh('https://x', fetchImpl), false, JSON.stringify(bad))
  }
  assert.equal(cache.get().missPerMCny, null) // static fallback intact (USD only)
})

await check('projection: official pricing drives cny/usd money fields', () => {
  const state3 = {
    turns: 1, lastTurn: 1, userMessages: 1, assistantMessages: 1, compactions: 0,
    pressureTokens: 550_000, contextWindow: 1_000_000,
    lastUsage: { inputTokens: 50_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 },
  }
  // off-peak v4-flash: CNY miss 1.5 / hit 0.05, USD miss 0.22 / hit 0.007
  // → discount 0.007/0.22 = 1/31.4; billable = 50K + 500K × (0.007/0.22)
  const price = { missPerMUsd: 0.22, hitPerMUsd: 0.007, missPerMCny: 1.5, hitPerMCny: 0.05, period: 'offpeak' }
  const v = healthView(state3, config, price)
  const billable = 50_000 + 500_000 * (0.007 / 0.22)
  assert.ok(Math.abs(v.effectivePerRound - billable) < 1e-6)
  assert.ok(Math.abs(v.effectivePerRoundCny - (billable * 1.5) / 1e6) < 1e-9) // ¥0.10/轮
  assert.ok(Math.abs(v.effectivePerRoundUsd - (billable * 0.22) / 1e6) < 1e-9) // $0.015/轮
  assert.equal(v.pricePeriod, 'offpeak')
})


/* ---------- /compass command handler ---------- */
const cmdDef = healthCommandDefinition(ctx, config)

await check('assess: non-finite remainingRounds is treated as not provided (no NaN money)', async () => {
  // NaN 能通过 `!== null` 检查——若直接参与乘法会产出 ¥NaN/$NaN。归一化后
  // expectedTotal 全 null，文案无 NaN。
  const report = await assess(ctx, session, 'agent-1', signal, config, { remainingRounds: NaN })
  assert.equal(report.signals.expectedTotalTokens, null)
  assert.equal(report.signals.expectedTotalUsd, null)
  assert.equal(report.signals.expectedTotalCny, null)
  const text = buildCommandText(report, { minimal: false })
  assert.ok(!text.includes('NaN'), `NaN must never leak into the report: ${text}`)
})

await check('command: remaining=<illegal> parses to null, never NaN', async () => {
  for (const raw of ['remaining=abc', 'remaining=-5', 'remaining=', 'remaining=1e9', 'remaining=0']) {
    const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: raw, signal })
    assert.equal(result.kind, 'success')
    assert.ok(!result.text.includes('NaN'), `${raw} must not leak NaN`)
  }
})

await check('command: full report text', async () => {
  const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: '', signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('健康度：**黄**'))
  assert.ok(result.text.includes('详情'))
  assert.ok(result.text.includes('切换前检查'))
})

await check('command: minimal mode', async () => {
  const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'minimal', signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('minimal 模式'))
  assert.ok(!result.text.includes('git 仓库'))
})

await check('command: explicit no-git / no-handoff parameters skip those probes', async () => {
  const noGit = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'no-git', signal })
  assert.equal(noGit.kind, 'success')
  assert.ok(noGit.text.includes('git 检查：已跳过'))
  assert.ok(!noGit.text.includes('git 仓库：'), 'no-git 不得运行 git 探测')
  const noHandoff = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'no-handoff', signal })
  assert.equal(noHandoff.kind, 'success')
  assert.ok(noHandoff.text.includes('交接文档检查：已跳过'))
  assert.ok(noHandoff.text.includes('git 仓库：早期工作可追溯'), 'no-handoff 只跳过 handoff，git 仍探测')
})

await check('assess: config-disabled git/handoff annotate the skip (symmetric with processes)', async () => {
  const offCfg = resolveConfig({ checks: { git: { enabled: false }, handoff: { enabled: false } } })
  const report = await assess(ctx, session, 'agent-1', signal, offCfg, {})
  assert.ok(report.probes.some(p => p.includes('git 检查：已跳过（配置关闭）')), `got: ${JSON.stringify(report.probes)}`)
  assert.ok(report.probes.some(p => p.includes('交接文档检查：已跳过（配置关闭）')), `got: ${JSON.stringify(report.probes)}`)
})

await check('command: doc= parameter probes a user-named handoff file', async () => {
  const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'doc=HANDOFF.md', signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('交接文档：已就位'))
})

await check('assess: unsafe handoff paths (absolute / .. escape) are skipped, never probed', async () => {
  // docName / config.paths 可被提示注入引导到 cwd 之外——白名单拒绝并标注。
  const unsafe = await assess(ctx, session, 'agent-1', signal, config, { docName: '/etc/passwd' })
  assert.ok(unsafe.probes.some(p => p.includes('已跳过不安全路径')), `got: ${JSON.stringify(unsafe.probes)}`)
  assert.equal(unsafe.handoff.hasHandoff, null)
  const dotdot = await assess(ctx, session, 'agent-1', signal, config, { docName: '../../secret.md' })
  assert.ok(dotdot.probes.some(p => p.includes('已跳过不安全路径')))
  // 相对子目录路径（如 docs/HANDOFF.md）仍允许。
  const relCfg = resolveConfig({ checks: { handoff: { paths: ['docs/HANDOFF.md'] } } })
  const rel = await assess(ctx, session, 'agent-1', signal, relCfg, {})
  assert.ok(!rel.probes.some(p => p.includes('已跳过不安全路径')), `got: ${JSON.stringify(rel.probes)}`)
})

await check('command: no session degrades to error', async () => {
  const result = await cmdDef.handler({ agent: { id: 'agent-1', session: undefined }, rawInput: '', signal })
  assert.equal(result.kind, 'error')
})

/* ---------- context_compass tool ---------- */
const tool = sessionHealthTool(ctx, config)
await check('tool: registers name + read kind', () => {
  assert.equal(tool.name, 'context_compass')
  assert.equal(tool.presentCall({ reason: 'x' }).kind, 'read')
})

await check('tool: execute returns structured verdict + report', async () => {
  const value = await tool.execute({ reason: '自检', remainingRounds: 12 }, {
    agent: { id: 'agent-1', session },
    signal,
  })
  // A3 经济升级：计费当量 300K ≥ max(50K, 0.3×1M)=300K 且剩余 12 ≥ 10 → yellow 升 red。
  assert.equal(value.severity, 'red')
  assert.equal(value.recommendation, 'suggest-switch')
  assert.equal(value.signals.windowPercent, 30)
  assert.equal(value.signals.tokensPerRound, 300_000)
  assert.equal(value.signals.messageCount, 3) // 2 user + 1 assistant in the stub events
  assert.equal(value.handoffReady.isGitRepo, true)
  assert.ok(typeof value.report === 'string' && value.report.length > 0)
})

await check('tool: A3 — remaining below floor keeps the economy tier at yellow', async () => {
  const low = await tool.execute({ reason: '自检', remainingRounds: 5 }, {
    agent: { id: 'agent-1', session },
    signal,
  })
  assert.equal(low.severity, 'yellow') // 剩余 5 < 10：不升级
  const none = await tool.execute({ reason: '自检' }, {
    agent: { id: 'agent-1', session },
    signal,
  })
  assert.equal(none.severity, 'yellow') // 未提供剩余轮数：不升级
})

await check('tool: danger-zone recommendation surfaces for the model', async () => {
  const value = await tool.execute({ dependsOnEarly: true }, {
    agent: { id: 'agent-1', session },
    signal,
  })
  assert.equal(value.recommendation, 'danger-zone')
})

await check('tool: render produces text from the canonical value', () => {
  const blocks = tool.output.render({}, {
    severity: 'yellow',
    recommendation: 'suggest-switch',
    summary: '建议在任务边界收尾',
    report: '# 报告',
    signals: {},
    handoffReady: {},
  })
  assert.equal(blocks[0].type, 'text')
  assert.ok(blocks[0].text.includes('# 报告'))
})

await check('tool: execute without session throws', async () => {
  await assert.rejects(
    () => tool.execute({}, { agent: undefined, signal }),
    /无法定位当前会话/,
  )
})

/* ---------- report text builder ---------- */
await check('buildCommandText: blue tier wording', () => {
  const text = buildCommandText({
    severity: 'blue',
    recommendation: 'continue-with-note',
    summary: 'x',
    reason: '上下文占用 42%（中等）——继续没问题，留意窗口压力。',
    signals: { total: 420_000, window: 1_000_000, ratio: 0.42, turns: 8, userMessages: 10, assistantMessages: 9, compactions: 1, compactionRatio: null },
    probes: [],
    handoff: { isGitRepo: null, hasHandoff: null, runningProcesses: [] },
  }, { minimal: false })
  assert.ok(text.includes('健康度：**蓝**'))
  assert.ok(text.includes('已压缩 1 次'))
  assert.ok(!text.includes('切换前检查')) // blue: no switch checklist
})

await check('buildCommandText: compression ratio line with caliber note', () => {
  const text = buildCommandText({
    severity: 'yellow',
    recommendation: 'suggest-switch',
    summary: 'x',
    reason: 'r',
    signals: { total: 600_000, window: 1_000_000, ratio: 0.6, turns: 20, userMessages: 30, assistantMessages: 29, compactions: 2, compactionRatio: 0.42 },
    probes: [],
    handoff: { isGitRepo: null, hasHandoff: null, runningProcesses: [] },
  }, { minimal: false })
  assert.ok(text.includes('- 已压缩 2 次：早期细节概要化（上次压缩比例 ≈ 42%，按压缩前后压力快照差值推断——快照口径，非精确统计）'))
  // Defensive: an unknown ratio must not render NaN.
  const unknown = buildCommandText({
    severity: 'yellow', recommendation: 'suggest-switch', summary: 'x', reason: 'r',
    signals: { total: 1, window: 1, ratio: 1, turns: 1, userMessages: 1, assistantMessages: 1, compactions: 1 },
    probes: [],
    handoff: { isGitRepo: null, hasHandoff: null, runningProcesses: [] },
  }, { minimal: false })
  assert.ok(unknown.includes('已压缩 1 次：早期细节概要化'))
  assert.ok(!unknown.includes('NaN'))
})

await check('knowledge: snapshot block appended to the report (fixed keys, grep-able)', () => {
  const text = buildCommandText({
    severity: 'yellow',
    recommendation: 'suggest-switch',
    summary: 'x',
    reason: 'r',
    signals: { total: 600_000, window: 1_000_000, ratio: 0.6, turns: 20, userMessages: 30, assistantMessages: 29, compactions: 2, compactionRatio: 0.42 },
    probes: [],
    handoff: { isGitRepo: true, hasHandoff: false, runningProcesses: [], uncommittedCount: 3, lastCommit: 'abc' },
  }, { minimal: false })
  assert.ok(text.includes('交接快照（context-compass-handoff-snapshot）'))
  assert.ok(text.includes('severity: yellow'))
  assert.ok(text.includes('recommendation: suggest-switch'))
  assert.ok(text.includes('compacted: 2'))
  assert.ok(text.includes('compression_ratio: 42'))
  assert.ok(text.includes('uncommitted: 3'))
  assert.ok(text.includes('handoff_ready: false'))
  assert.ok(/timestamp: \d{4}-\d{2}-\d{2}T/.test(text))
  // No compactions → the compacted/compression keys are omitted, others stay.
  const noCompact = buildCommandText({
    severity: 'green', recommendation: 'continue', summary: 'x', reason: 'r',
    signals: { total: 10_000, window: 1_000_000, ratio: 0.01, turns: 2, userMessages: 3, assistantMessages: 2, compactions: 0 },
    probes: [], handoff: { isGitRepo: null, hasHandoff: null, runningProcesses: [] },
  }, { minimal: true })
  assert.ok(noCompact.includes('severity: green'))
  assert.ok(!noCompact.includes('compacted:'))
  assert.ok(!noCompact.includes('compression_ratio:'))
})

/* ---------- multi-session overview (panel data + RPC) ---------- */
const healthOf = (severity, extra = {}) => ({
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
const overviewServices = {
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
const overviewCtx = { get: name => overviewServices[name] }

await check('overview: snapshot / cache / cold fallback + titles + severity sort', async () => {
  const rows = await buildOverview(overviewCtx, signal)
  assert.equal(rows.length, 4)
  // Red first, yellow second, green third, unknown last (host sort).
  assert.deepEqual(rows.map(r => r.id), ['live-red', 'cold-yellow', 'live-green', 'cold-unknown'])
  assert.equal(rows[0].health.severity, 'red')
  assert.equal(rows[1].health.severity, 'yellow')
  assert.equal(rows[2].health.severity, 'green')
  assert.equal(rows[3].health, null) // cold + no cache row → null, never a crash
  // Activity falls back to loaded/cold from the source `live` flag when the
  // agents service is absent (no running detection, never a false 运行中).
  assert.equal(rows[0].status, 'loaded') // source live:true → loaded
  assert.equal(rows[1].status, 'cold')   // source live:false → cold
  // Titles are background-filled (never awaited on first paint): first frame
  // returns null; the dedicated title-cache check covers the fill+hit cycle.
  assert.equal(rows[0].title, null)
  assert.equal(rows[3].title, null)
  assert.equal(rows[0].createdAt, 100)
})

await check('overview: same-tier rows sort newest-first', () => {
  const rows = sortOverviewRows([
    { id: 'a', title: null, status: 'cold', createdAt: 100, health: healthOf('green') },
    { id: 'b', title: null, status: 'cold', createdAt: 400, health: healthOf('green') },
    { id: 'c', title: null, status: 'cold', createdAt: 200, health: healthOf('red') },
  ])
  assert.deepEqual(rows.map(r => r.id), ['c', 'b', 'a'])
  assert.equal(rankOf(healthOf('red')), 0)
  assert.equal(rankOf(healthOf('yellow')), 1)
  assert.equal(rankOf(healthOf('blue')), 2)
  assert.equal(rankOf(healthOf('green')), 3)
  assert.equal(rankOf(null), 4)
  assert.equal(rankOf(undefined), 4)
})

await check('overview: activity from the agents service — running only when agent.status=running', async () => {
  const agentsCtx = {
    get: name => ({
      ...overviewServices,
      agents: {
        get: id => id === 'live-red'
          ? { status: 'running' }
          : id === 'live-green'
            ? { status: 'idle' }
            : undefined, // cold-yellow / cold-unknown: no agent at all
      },
    })[name],
  }
  const rows = await buildOverview(agentsCtx, signal)
  assert.equal(rows[0].status, 'running')  // agent running → 运行中
  assert.equal(rows[1].status, 'cold')     // source live:false + no agent → cold
  assert.equal(rows[2].status, 'loaded')   // agent idle → loaded
  assert.equal(rows[3].status, 'cold')
})

await check('overview: activity sort — running > loaded > cold inside a tier', () => {
  const rows = sortOverviewRows([
    { id: 'idle', title: null, status: 'loaded', createdAt: 100, health: healthOf('green') },
    { id: 'running', title: null, status: 'running', createdAt: 300, health: healthOf('green') },
    { id: 'old-run', title: null, status: 'running', createdAt: 200, health: healthOf('green') },
    { id: 'cold', title: null, status: 'cold', createdAt: 400, health: healthOf('green') },
  ])
  // Running (newest first) → loaded → cold, all same green tier.
  assert.deepEqual(rows.map(r => r.id), ['running', 'old-run', 'idle', 'cold'])
})

await check('overview: absent sessionQuery degrades to empty list', async () => {
  assert.deepEqual(await buildOverview({ get: () => undefined }, signal), [])
})

await check('overview: top-level + archive filtering matches the sidebar', async () => {
  // Subagent children and archived sessions are excluded everywhere; the
  // cwd / workspace membership plays no role (sidebar shows all of them).
  const wsServices = {
    ...overviewServices,
    workspaceRegistry: { archivedSessionIds: ['out'] },
    sessionQuery: {
      listSessions: async () => [
        { header: { id: 'in-ws', createdAt: 1, cwd: '/ws' }, live: false, persisted: true },
        { header: { id: 'in-ws-sub', createdAt: 2, cwd: '/ws/sub', origin: 'subagent' }, live: false, persisted: true },
        { header: { id: 'out', createdAt: 3, cwd: '/other' }, live: false, persisted: true },
        { header: { id: 'no-cwd', createdAt: 4 }, live: false, persisted: true },
      ],
      readTitleSnapshots: async () => [],
    },
  }
  const rows = await buildOverview({ get: name => wsServices[name] }, signal)
  assert.deepEqual(rows.map(r => r.id), ['no-cwd', 'in-ws']) // archived + subagent out, newest first
})

await check('overview: parallel cold loads backfill health', async () => {
  const slowCtx = {
    get: name => ({
      ...overviewServices,
      sessionProjectionCache: {
        cachedSnapshot: () => undefined,
        coldSnapshot: async id => {
          await new Promise(resolve => setTimeout(resolve, 20))
          return { values: { sessionHealth: healthOf('blue') } }
        },
      },
      sessionQuery: {
        listSessions: async () => [{ header: { id: 'cold-a', createdAt: 1 }, live: false, persisted: true }],
        readTitleSnapshots: async () => [],
      },
    })[name],
  }
  const rows = await buildOverview(slowCtx, signal)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].health.severity, 'blue') // async cold load backfilled
})

await check('overview: archived sessions are hidden everywhere', async () => {
  const archivedCtx = {
    get: name => ({
      ...overviewServices,
      workspaceRegistry: { archivedSessionIds: ['a2'] },
      sessionQuery: {
        listSessions: async () => [
          { header: { id: 'a1', createdAt: 1, cwd: '/ws' }, live: false, persisted: true },
          { header: { id: 'a2', createdAt: 2, cwd: '/ws' }, live: false, persisted: true },
        ],
        readTitleSnapshots: async () => [],
      },
    })[name],
  }
  const rows = await buildOverview(archivedCtx, signal)
  assert.deepEqual(rows.map(r => r.id), ['a1'])
})

await check('overview: title cache — first frame null, background fill, next hit', async () => {
  clearTitleCache()
  const titleCtx = {
    get: name => ({
      ...overviewServices,
      sessionQuery: {
        listSessions: async () => [{ header: { id: 't1', createdAt: 1 }, live: false, persisted: true }],
        readTitleSnapshots: async ids => ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { title: { title: `T-${id}` } } })),
      },
    })[name],
  }
  const first = await buildOverview(titleCtx, signal)
  assert.equal(first.length, 1)
  assert.equal(first[0].title, null) // cache miss: no log read on first paint
  await new Promise(resolve => setTimeout(resolve, 50)) // background fill settles
  const second = await buildOverview(titleCtx, signal)
  assert.equal(second[0].title, 'T-t1') // cache hit on the next frame
  clearTitleCache()
})

await check('overview: one broken record degrades that row only', async () => {
  const brokenCtx = {
    get: name => ({
      ...overviewServices,
      sessionProjections: { snapshot: () => { throw new Error('boom') } },
      sessionProjectionCache: { cachedSnapshot: () => { throw new Error('boom') }, coldSnapshot: async () => { throw new Error('boom') } },
    })[name],
  }
  const rows = await buildOverview(brokenCtx, signal)
  assert.equal(rows.length, 4)
  assert.ok(rows.every(r => r.health === null)) // per-record failures degrade, never throw
})

/* ---------- overview RPC handler ---------- */
function fakeRes() {
  const out = { status: null, headers: null, body: null }
  return {
    out,
    writeHead: (status, headers) => { out.status = status; out.headers = headers },
    end: body => { out.body = body },
  }
}
function fakeReq(method, body, remoteAddress) {
  const req = { method, socket: { remoteAddress } }
  req[Symbol.asyncIterator] = async function* () { if (body !== undefined) yield body }
  return req
}

await check('overview rpc: POST overview → 200 + sorted sessions', async () => {
  const res = fakeRes()
  await handleOverviewRpc(fakeReq('POST', JSON.stringify({ method: 'overview' }), '127.0.0.1'), res, overviewCtx, config)
  assert.equal(res.out.status, 200)
  const json = JSON.parse(res.out.body)
  assert.equal(json.ok, true)
  assert.deepEqual(json.result.sessions.map(r => r.id), ['live-red', 'cold-yellow', 'live-green', 'cold-unknown'])
})

await check('overview rpc: non-POST → 405', async () => {
  const res = fakeRes()
  await handleOverviewRpc(fakeReq('GET', undefined, '127.0.0.1'), res, overviewCtx, config)
  assert.equal(res.out.status, 405)
})

await check('overview rpc: non-loopback peer → 403', async () => {
  const res = fakeRes()
  await handleOverviewRpc(fakeReq('POST', '{}', '10.0.0.5'), res, overviewCtx, config)
  assert.equal(res.out.status, 403)
})

await check('overview rpc: malformed json → 400, unknown method → 400', async () => {
  const bad = fakeRes()
  await handleOverviewRpc(fakeReq('POST', '{nope', '127.0.0.1'), bad, overviewCtx, config)
  assert.equal(bad.out.status, 400)
  const unknown = fakeRes()
  await handleOverviewRpc(fakeReq('POST', JSON.stringify({ method: 'nope' }), '127.0.0.1'), unknown, overviewCtx, config)
  assert.equal(unknown.out.status, 400)
})

await check('overview rpc: oversized body → 413 (defensive against OOM)', async () => {
  const big = fakeRes()
  const huge = JSON.stringify({ method: 'overview', pad: 'x'.repeat(20 * 1024) })
  await handleOverviewRpc(fakeReq('POST', huge, '127.0.0.1'), big, overviewCtx, config)
  assert.equal(big.out.status, 413)
  assert.equal(JSON.parse(big.out.body).error, 'request body too large')
})
/* ---------- B3: handoff summary copy (RPC method `summary`) ---------- */
await check('summary: buildHandoffSummary — plain text with real checklist state', () => {
  const text = buildHandoffSummary({
    severity: 'yellow',
    recommendation: 'suggest-switch',
    summary: '建议在任务边界收尾',
    reason: 'r',
    signals: { total: 600_000, window: 1_000_000, ratio: 0.6, turns: 20, userMessages: 30, assistantMessages: 29, compactions: 2, compactionRatio: 0.42, cacheHitRate: 0.9 },
    probes: [],
    handoff: { isGitRepo: true, hasHandoff: true, runningProcesses: [], uncommittedCount: 3, lastCommit: 'abc123', branchLine: '## main...origin/main [ahead 2]' },
  })
  assert.ok(text.includes('上下文罗盘摘要'))
  assert.ok(text.includes('健康度：yellow'))
  assert.ok(text.includes('会话规模：20 轮 / 59 条消息'))
  assert.ok(text.includes('每轮输入：约 600K token（窗口 60%）'))
  assert.ok(text.includes('缓存命中：90%'))
  assert.ok(text.includes('已压缩：2 次（上次压缩比例 ≈ 42%）'))
  assert.ok(text.includes('未提交变更：3 个'))
  assert.ok(text.includes('交接文档：已就位'))
  assert.ok(text.includes('最新 commit：abc123'))
  assert.ok(text.includes('分支：## main...origin/main [ahead 2]'))
  assert.ok(/时间：\d{4}-\d{2}-\d{2}T/.test(text))
})

await check('summary rpc: sessionId missing → 400, unknown session → 404', async () => {
  const noId = fakeRes()
  await handleOverviewRpc(fakeReq('POST', JSON.stringify({ method: 'summary' }), '127.0.0.1'), noId, overviewCtx, config)
  assert.equal(noId.out.status, 400)
  const noSess = fakeRes()
  const bareCtx = {
    get: name => name === 'sessions' ? { get: () => undefined }
      : name === 'agents' ? { get: () => undefined } : undefined,
  }
  await handleOverviewRpc(fakeReq('POST', JSON.stringify({ method: 'summary', sessionId: 'nope' }), '127.0.0.1'), noSess, bareCtx, config)
  assert.equal(noSess.out.status, 404)
})

await check('summary rpc: valid session → 200 + text', async () => {
  // Reuse the assess-level services so the summary path can run assess().
  const summaryCtx = {
    get: name => name === 'sessions'
      ? { get: id => (id === 'agent-1' ? { header: { cwd: '/tmp/ws', id: 'agent-1' } } : undefined) }
      : name === 'agents'
        ? { get: id => (id === 'agent-1' ? { id: 'agent-1' } : undefined) }
        : services[name],
  }
  const res = fakeRes()
  await handleOverviewRpc(fakeReq('POST', JSON.stringify({ method: 'summary', sessionId: 'agent-1' }), '127.0.0.1'), res, summaryCtx, config)
  assert.equal(res.out.status, 200)
  const json = JSON.parse(res.out.body)
  assert.equal(json.ok, true)
  assert.ok(typeof json.result.text === 'string')
  assert.ok(json.result.text.includes('上下文罗盘摘要'))
  assert.ok(json.result.text.includes('健康度：yellow'))
})

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall smoke checks passed')
