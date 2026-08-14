/**
 * dsh-session-health — client bundle mount test.
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
assert.equal(handoff.id, 'dsh-session-health')

// 2) Materialize the module: the loader calls factory(require) and uses the
//    returned module.exports as the plugin module.
const plugin = handoff.factory(require)
assert.equal(typeof plugin.apply, 'function', 'exports must carry apply')
assert.equal(plugin.name, 'dsh-session-health')
assert.ok(Array.isArray(plugin.inject), 'exports must carry the inject list')
assert.ok(plugin.inject.includes('remote'), 'ctx.remote reads need the remote root injected')
assert.ok(plugin.inject.includes('remote.commands'), 'remote.commands sub-service must be injected')
assert.ok(!plugin.inject.includes('remote.sessionHealth'), 'a plugin Remote can never mount client-side — must not be injected')
console.log('  ok  bundle registered via __ModuleLoader__ with apply/inject/name')

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

try {
  await ctx.plugin(plugin).await()
} catch (error) {
  console.error('client mount FAILED — apply threw (missing inject?):')
  throw error
}

// 4) apply ran: the badge seat was registered.
assert.equal(seats.length, 1, 'apply must register exactly one slot seat')
assert.equal(seats[0].name, 'conversation.session.header.utilities')
// The seat factory must produce a working slots.register call.
const registration = seats[0].fn()
assert.equal(registration[0].id, 'session-health-dot')
console.log('  ok  apply ran: badge seat registered in conversation.session.header.utilities')

// 5) The stylesheet was injected the client-modules way.
assert.equal(styleTags.length, 1, 'apply must create exactly one style tag')
assert.equal(styleTags[0].dataset.plugin, 'dsh-session-health', 'style tag must carry data-plugin (HMR ownership)')
assert.ok(styleTags[0].textContent.includes('.sh-badge'), 'style tag must carry the badge CSS')
console.log('  ok  stylesheet injected as <style data-plugin="dsh-session-health">')

console.log('\nclient mount smoke passed')
process.exit(0)
