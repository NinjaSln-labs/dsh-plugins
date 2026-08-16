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

// 2b) The compaction-aware merge helper is exported and correct.
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

// 4) apply ran: the badge seat + the two overview seats were registered.
assert.equal(seats.length, 3, 'apply must register exactly three slot seats')
const byName = Object.fromEntries(seats.map(s => [s.name, s]))
assert.ok(byName['conversation.session.header.utilities'], 'badge seat registered')
assert.ok(byName['sidebar.footer.action'], 'overview opener seat registered')
assert.ok(byName['shell.overlay'], 'overview panel seat registered')
// Each seat factory must produce a working slots.register call.
const badgeReg = byName['conversation.session.header.utilities'].fn()
assert.equal(badgeReg[0].id, 'session-health-dot')
const footerReg = byName['sidebar.footer.action'].fn()
assert.equal(footerReg[0].id, 'session-health-overview')
assert.equal(footerReg[0].name, 'sidebar.footer.action')
const overlayReg = byName['shell.overlay'].fn()
assert.equal(overlayReg[0].id, 'session-health-overview-panel')
assert.equal(overlayReg[0].name, 'shell.overlay')
console.log('  ok  apply ran: badge + overview opener + overview panel seats registered')

// 5) The stylesheet was injected the client-modules way.
assert.equal(styleTags.length, 1, 'apply must create exactly one style tag')
assert.equal(styleTags[0].dataset.plugin, 'dsh-context-compass', 'style tag must carry data-plugin (HMR ownership)')
assert.ok(styleTags[0].textContent.includes('.sh-badge'), 'style tag must carry the badge CSS')
console.log('  ok  stylesheet injected as <style data-plugin="dsh-context-compass">')

console.log('\nclient mount smoke passed')
process.exit(0)
