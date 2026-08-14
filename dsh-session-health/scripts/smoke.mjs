/**
 * dsh-session-health — smoke test.
 *
 * Drives the built lib/ with stub services: projection fold over synthetic
 * events, the shared assess() core, the /health command handler, and the
 * session_health tool execute. Run after `npm run build`.
 *
 *   npm run build && npm run smoke
 */
import assert from 'node:assert/strict'
import { sessionHealthProjectionDefinition, applyHealthEvent, healthView } from '../lib/projection.js'
import { assess } from '../lib/assess.js'
import { healthCommandDefinition, buildCommandText } from '../lib/command.js'
import { sessionHealthTool } from '../lib/tool.js'
import { resolveConfig } from '../lib/config.js'
import { PriceCache } from '../lib/pricing.js'

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
  { type: 'assistant/message', data: { usage: { inputTokens: 60_000, outputTokens: 500, cacheReadTokens: 300_000 } } },
  { type: 'step/end', data: { turn: 2 } },
  { type: 'user/message', data: {} },
  { type: 'assistant/message', data: {} },
  { type: 'compaction/end', data: {} },
  { type: 'assistant/chunk', data: { chunk: { type: 'usage', usage: { inputTokens: 32_000, cacheReadTokens: 0 } } } },
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

await check('projection: economy floor outranks ratio (default config)', () => {
  const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
  const viewOf = (pressure, window) => healthView(
    { ...base, ...(pressure !== null ? { pressureTokens: pressure } : {}), ...(window !== null ? { contextWindow: window } : {}) },
    config,
  )
  assert.equal(viewOf(60_000, null).severity, 'yellow') // economy floor, no window
  assert.equal(viewOf(10_000, null).severity, 'green')
  assert.equal(viewOf(100_000, 1_000_000).severity, 'yellow') // 10% ratio but economy 100K
})

await check('projection: message-count proxy escalates green → blue', () => {
  const base = {
    turns: 40, lastTurn: null, userMessages: 500, assistantMessages: 500,
    compactions: 0, pressureTokens: 20_000, contextWindow: 1_000_000,
  }
  const view = healthView(base, config) // 2% occupancy, 1000 messages ≥ 800 proxy
  assert.equal(view.severity, 'blue')
  assert.ok(view.advice.includes('代理指标'))
  assert.ok(view.advice.includes('1000'))
  const low = healthView({ ...base, userMessages: 400, assistantMessages: 300 }, config)
  assert.equal(low.severity, 'green') // 700 messages: no proxy, low occupancy
})

await check('projection: cache hit rate + effective per-round cost (token + USD)', () => {
  const state2 = {
    turns: 1, lastTurn: 1, userMessages: 1, assistantMessages: 1, compactions: 0,
    pressureTokens: 550_000, contextWindow: 1_000_000,
    lastUsage: { inputTokens: 50_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 },
  }
  const v = healthView(state2, config) // cacheHitDiscount 0.1, inputPricePerM 0.28
  assert.ok(Math.abs(v.cacheHitRate - 500_000 / 550_000) < 1e-9)
  assert.equal(v.uncachedInputTokens, 50_000)
  assert.equal(v.cacheReadTokens, 500_000)
  assert.equal(v.effectivePerRound, 50_000 + 500_000 * 0.1) // 100K billable-equivalent
  assert.ok(Math.abs(v.effectivePerRoundUsd - (100_000 * 0.28) / 1_000_000) < 1e-9) // $0.028/轮
  const empty = healthView({ ...state2, lastUsage: undefined }, config)
  assert.equal(empty.cacheHitRate, null)
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
  tokenMeter: { measure: () => ({ totalTokens: 132_000 }) },
  llm: { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) },
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) },
  sessionQuery: { listEvents: async () => queryEvents },
  sandboxPolicy: { workspaceRoot: '/tmp/ws' },
  fs: {
    resolve: async p => p,
    stat: async p => (p === '.git' || p === 'HANDOFF.md' ? {} : undefined),
  },
  subprocess: undefined,
}
const ctx = { get: name => services[name] }

await check('assess: economy yellow + probes + counts', async () => {
  const report = await assess(ctx, session, 'agent-1', signal, config, { docName: 'HANDOFF.md' })
  assert.equal(report.severity, 'yellow') // 132K >= 50K economy floor
  assert.equal(report.signals.turns, 2)
  assert.equal(report.signals.userMessages, 2)
  assert.equal(report.signals.total, 132_000)
  assert.equal(report.handoff.isGitRepo, true)
  assert.equal(report.handoff.hasHandoff, true)
  assert.equal(report.recommendation, 'suggest-switch')
  assert.ok(report.probes.some(p => p.includes('git 仓库')))
  assert.ok(report.probes.some(p => p.includes('交接文档：已就位')))
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
                cacheHitRate: 0.9, uncachedInputTokens: 13_200, cacheReadTokens: 118_800,
                effectivePerRound: 25_080, // 13200 + 118800*0.1
                effectivePerRoundUsd: (25_080 * 0.28) / 1_000_000, // $0.007/轮
              },
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

/* ---------- pricing (priceSource auto) ---------- */
await check('pricing: auto refresh picks up a valid document', async () => {
  const cache = new PriceCache({ inputPricePerM: 0.28, cacheHitDiscount: 0.1 })
  const fetchImpl = async () => ({ ok: true, json: async () => ({ currency: 'usd', inputPerM: 1.5, cacheHitDiscount: 0.2 }) })
  assert.equal(await cache.refresh('https://x', fetchImpl), true)
  assert.equal(cache.get().inputPricePerM, 1.5)
  assert.equal(cache.get().cacheHitDiscount, 0.2)
})

await check('pricing: failure keeps the last good price', async () => {
  const cache = new PriceCache({ inputPricePerM: 0.28, cacheHitDiscount: 0.1 })
  const ok = async () => ({ ok: true, json: async () => ({ currency: 'usd', inputPerM: 1.5 }) })
  await cache.refresh('https://x', ok)
  const fail = async () => { throw new Error('offline') }
  assert.equal(await cache.refresh('https://x', fail), false)
  assert.equal(cache.get().inputPricePerM, 1.5) // last good price survives
  assert.equal(cache.get().cacheHitDiscount, 0.1) // fallback discount from static
})

await check('pricing: invalid documents are rejected', async () => {
  const cache = new PriceCache({ inputPricePerM: 0.28, cacheHitDiscount: 0.1 })
  for (const bad of [
    { currency: 'eur', inputPerM: 1 },
    { inputPerM: -1 },
    { inputPerM: 'x' },
    { inputPerM: 1, cacheHitDiscount: 2 },
  ]) {
    const fetchImpl = async () => ({ ok: true, json: async () => bad })
    assert.equal(await cache.refresh('https://x', fetchImpl), false, JSON.stringify(bad))
  }
  assert.equal(cache.get().inputPricePerM, 0.28)
})

await check('assess: live pricing from the ctx cache overrides static config', async () => {
  const pricingCtx = {
    get: name => {
      if (name === 'sessionHealthPricing') {
        return { get: () => ({ inputPricePerM: 1.0, cacheHitDiscount: 0.1 }) }
      }
      if (name === 'sessionProjections') {
        return {
          snapshot: () => ({
            values: {
              sessionHealth: {
                severity: 'yellow', advice: 'a', ratio: 0.13, total: 132_000, window: 1_000_000,
                turns: 2, userMessages: 2, assistantMessages: 1, compactions: 0,
                cacheHitRate: 0.9, uncachedInputTokens: 13_200, cacheReadTokens: 118_800,
                effectivePerRound: 25_080, effectivePerRoundUsd: (25_080 * 1.0) / 1_000_000,
              },
            },
          }),
        }
      }
      return services[name]
    },
  }
  const report = await assess(pricingCtx, session, 'agent-1', signal, config, {})
  assert.equal(report.signals.inputPricePerM, 1.0)
  const text = buildCommandText(report, { minimal: false })
  assert.ok(text.includes('$1/M 估算'), 'cost note uses the live price')
})

/* ---------- /health command handler ---------- */
const cmdDef = healthCommandDefinition(ctx, config)
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

await check('command: doc= parameter probes a user-named handoff file', async () => {
  const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'doc=HANDOFF.md', signal })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('交接文档：已就位'))
})

await check('command: no session degrades to error', async () => {
  const result = await cmdDef.handler({ agent: { id: 'agent-1', session: undefined }, rawInput: '', signal })
  assert.equal(result.kind, 'error')
})

/* ---------- session_health tool ---------- */
const tool = sessionHealthTool(ctx, config)
await check('tool: registers name + read kind', () => {
  assert.equal(tool.name, 'session_health')
  assert.equal(tool.presentCall({ reason: 'x' }).kind, 'read')
})

await check('tool: execute returns structured verdict + report', async () => {
  const value = await tool.execute({ reason: '自检', remainingRounds: 12 }, {
    agent: { id: 'agent-1', session },
    signal,
  })
  assert.equal(value.severity, 'yellow')
  assert.equal(value.recommendation, 'suggest-switch')
  assert.equal(value.signals.windowPercent, 13)
  assert.equal(value.signals.tokensPerRound, 132_000)
  assert.equal(value.signals.messageCount, 3) // 2 user + 1 assistant in the stub events
  assert.equal(value.handoffReady.isGitRepo, true)
  assert.ok(typeof value.report === 'string' && value.report.length > 0)
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
    signals: { total: 420_000, window: 1_000_000, ratio: 0.42, turns: 8, userMessages: 10, assistantMessages: 9, compactions: 1 },
    probes: [],
    handoff: { isGitRepo: null, hasHandoff: null, runningProcesses: [] },
  }, { minimal: false })
  assert.ok(text.includes('健康度：**蓝**'))
  assert.ok(text.includes('已压缩 1 次'))
  assert.ok(!text.includes('切换前检查')) // blue: no switch checklist
})

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall smoke checks passed')
