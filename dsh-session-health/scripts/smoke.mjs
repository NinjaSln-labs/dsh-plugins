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
