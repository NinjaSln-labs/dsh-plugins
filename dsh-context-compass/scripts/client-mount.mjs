/**
 * dsh-context-compass — client bundle mount test.
 *
 * Reproduces the browser boot path in Node: the built bundle registers via
 * `window.__ModuleLoader__.load({ id, factory })`, the factory returns the
 * module exports, and the loader mounts those exports through `ctx.plugin()`
 * with the exports' own `inject` list. Verifies:
 * - the bundle registers with the right id and exports apply/inject/name
 * - every injected service resolves in a realistic context (no cordis
 *   "cannot get property X without inject", no pending waits)
 * - apply() actually runs and registers the badge seat
 *
 * This catches both failure modes seen in the live boot: an inject entry
 * that can never resolve (remote.sessionHealth → pending forever) and a
 * missing inject entry (ctx.remote without 'remote' → hard throw).
 *
 *   npm run build && node scripts/client-mount.mjs
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'

const require = createRequire(import.meta.url)

// 1) Capture the __ModuleLoader__ registration the bundle performs on import.
let handoff = null
globalThis.window = {
  __ModuleLoader__: {
    load: h => {
      if (handoff !== null) throw new Error('duplicate registration')
      handoff = h
    },
  },
}
await import('../lib/client.js')
assert.ok(handoff !== null, 'bundle must register via window.__ModuleLoader__.load')
assert.equal(handoff.id, 'dsh-context-compass')

// 2) Materialize the module: the loader calls factory(require) and uses the
//    returned module.exports as the plugin module.
const plugin = handoff.factory(require)
assert.equal(typeof plugin.apply, 'function', 'exports must carry apply')
assert.equal(plugin.name, 'dsh-context-compass')
assert.ok(Array.isArray(plugin.inject), 'exports must carry the inject list')
assert.ok(plugin.inject.includes('remote'), 'ctx.remote reads need the remote root injected')
assert.ok(plugin.inject.includes('remote.commands'), 'remote.commands sub-service must be injected')
assert.ok(!plugin.inject.includes('remote.sessionHealth'), 'a plugin Remote can never mount client-side — must not be injected')
assert.ok(plugin.inject.includes('locale'), 'locale must be injected for the currency-by-region display')
console.log('  ok  bundle registered via __ModuleLoader__ with apply/inject/name')

// 2b) The /compass report parser is exported and correct.
const FULL_REPORT = [
  '**建议在任务边界收尾**（健康度：**黄**）',
  '上下文已占窗口 51%，早期内容开始被压缩；若剩余工作还多，开新会话更划算。',
  '',
  '详情：',
  '- 会话规模：17 轮 / 28 条消息 / 303 条回复',
  '- 每轮输入约 512K token（窗口 51%）；窗口 1M',
  '- 缓存命中率 100%（上次请求——命中高说明上下文稳定且便宜；压缩会重置命中）',
  '- 计费预期：约 ¥0.05/轮（≈$0.01；输入价 ¥1.5/M / $0.22 闲时价，缓存命中 ¥0.05/M / $0.007，不含输出）',
  '- 已压缩 2 次：早期细节概要化（上次压缩比例 ≈ 42%，按压缩前后压力快照差值推断——快照口径，非精确统计）',
  '',
  '切换前检查：',
  '- [x] 未提交变更：0 个',
  '- [ ] 已 push：## main...origin/main [ahead 2]',
].join('\n')
const parsed = plugin.parseCompassReport(FULL_REPORT)
assert.equal(parsed.severity, 'yellow')
assert.equal(parsed.summary, '建议在任务边界收尾（健康度：黄）')
assert.ok(parsed.reason.includes('上下文已占窗口 51%'))
assert.equal(parsed.metrics.length, 5)
assert.ok(parsed.metrics[4].startsWith('已压缩 2 次') && parsed.metrics[4].includes('上次压缩比例 ≈ 42%'))
assert.equal(parsed.checklist.length, 2)
const junk = plugin.parseCompassReport('随便一段文本\n没有结构')
assert.equal(junk.severity, null)
assert.equal(junk.summary, '随便一段文本')
console.log('  ok  parseCompassReport: severity/summary/metrics/checklist extraction')

// 2c) The compaction-aware merge helper is exported and correct.
const proj = {
  severity: 'yellow', advice: 'a', ratio: 0.6, total: 600_000, window: 1_000_000,
  turns: 1, userMessages: 1, assistantMessages: 1, compactions: 0,
}
const merged = plugin.mergePressure(proj, { pressureTokens: 650_000, projectedTokens: 300_000, contextWindow: 1_000_000 })
assert.equal(merged.total, 600_000, 'sessionHealth total wins when present')
assert.equal(merged.projected, 300_000, 'projectedTokens surfaces for the tooltip row')
assert.equal(merged.ratio, 0.6)
const fallback = plugin.mergePressure(undefined, { pressureTokens: 650_000, projectedTokens: 300_000, contextWindow: 2_000_000 })
assert.equal(fallback.total, 650_000)
assert.equal(fallback.window, 2_000_000)
assert.equal(fallback.ratio, 0.325)
const compacted = plugin.mergePressure(
  { severity: 'green', advice: 'a', ratio: null, total: null, window: 1_000_000, turns: 0, userMessages: 0, assistantMessages: 0, compactions: 0 },
  { projectedTokens: 300_000 },
)
assert.equal(compacted.total, 300_000, 'projectedTokens fills a missing host total')
console.log('  ok  mergePressure: compaction-aware occupancy merge')

// 2d) 压缩后判定滞后 (lagOf): severity rides last-wins pressure, the occupancy
//     bar rides compaction-aware projectedTokens — divergence after a
//     compaction is annotated until the next request refreshes the verdict.
const lagProj = {
  severity: 'yellow', advice: 'a', ratio: 0.6, total: 600_000, window: 1_000_000,
  turns: 1, userMessages: 1, assistantMessages: 1, compactions: 1,
}
assert.deepEqual(
  plugin.lagOf(lagProj, { pressureTokens: 600_000, projectedTokens: 300_000, contextWindow: 1_000_000 }),
  { lag: true, oldPct: 60, newPct: 30 },
  'post-compaction divergence ≥5pp with compactions>0 → lag annotated',
)
assert.deepEqual(
  plugin.lagOf({ ...lagProj, compactions: 0 }, { pressureTokens: 600_000, projectedTokens: 300_000, contextWindow: 1_000_000 }),
  { lag: false, oldPct: 60, newPct: 30 },
  'divergence without a recorded compaction → no annotation',
)
assert.deepEqual(
  plugin.lagOf(lagProj, { pressureTokens: 600_000, projectedTokens: 590_000, contextWindow: 1_000_000 }),
  { lag: false, oldPct: 60, newPct: 59 },
  'sub-5pp divergence → no annotation (noise guard)',
)
assert.deepEqual(plugin.lagOf(lagProj, undefined), { lag: false, oldPct: 60, newPct: null })
console.log('  ok  lagOf: 压缩后判定滞后标注 (divergence gate + noise floor)')

// 3) Mount through a real cordis Context with the injected services provided
//    the way the web shell provides them. A minimal document stub records the
//    stylesheet tag the apply path must create (the client-modules contract:
//    a <style data-plugin> tag on document.head — there is no 'styles' service).
const styleTags = []
const documentStub = {
  querySelector: () => null,
  createElement: tag => ({ tag, dataset: {}, textContent: '' }),
  head: {
    appendChild: el => { styleTags.push(el) },
  },
}
globalThis.document = documentStub

const seats = []
const ctx = new Context()
ctx.provide('slots', {
  inject: (name, fn) => { seats.push({ name, fn }) },
  register: (...args) => args,
})
ctx.provide('sessions', {
  binding: () => ({ session: { projections: { faceOf: () => undefined } } }),
})
ctx.provide('remote', {
  commands: { execute: async () => ({ ok: true }) },
})
ctx.provide('remote.commands', {
  execute: async () => ({ ok: true }),
})
ctx.provide('locale', { snapshot: { active: 'zh' } })

try {
  await ctx.plugin(plugin).await()
} catch (error) {
  console.error('client mount FAILED — apply threw (missing inject?):')
  throw error
}

// 4) apply ran: the badge + two overview seats + the /compass card seat.
assert.equal(seats.length, 4, 'apply must register exactly four slot seats')
const byName = Object.fromEntries(seats.map(s => [s.name, s]))
assert.ok(byName['conversation.session.header.utilities'], 'badge seat registered')
assert.ok(byName['sidebar.footer.action'], 'overview opener seat registered')
assert.ok(byName['shell.overlay'], 'overview panel seat registered')
assert.ok(byName['conversation.chat.commandview'], 'commandview seat registered')
// Each seat factory must produce a working slots.register call.
const badgeReg = byName['conversation.session.header.utilities'].fn()
assert.equal(badgeReg[0].id, 'session-health-dot')
const footerReg = byName['sidebar.footer.action'].fn()
assert.equal(footerReg[0].id, 'session-health-overview')
assert.equal(footerReg[0].name, 'sidebar.footer.action')
const overlayReg = byName['shell.overlay'].fn()
assert.equal(overlayReg[0].id, 'session-health-overview-panel')
assert.equal(overlayReg[0].name, 'shell.overlay')
const cardReg = byName['conversation.chat.commandview'].fn()
assert.equal(cardReg[0].name, 'conversation.chat.commandview')
assert.equal(cardReg[0].key, 'compass')
console.log('  ok  apply ran: badge + overview opener + overview panel + /compass card seats')

// 5) The stylesheet was injected the client-modules way.
assert.equal(styleTags.length, 1, 'apply must create exactly one style tag')
assert.equal(styleTags[0].dataset.plugin, 'dsh-context-compass', 'style tag must carry data-plugin (HMR ownership)')
assert.ok(styleTags[0].textContent.includes('.sh-badge'), 'style tag must carry the badge CSS')
console.log('  ok  stylesheet injected as <style data-plugin="dsh-context-compass">')

console.log('\nclient mount smoke passed')
process.exit(0)
