/**
 * dsh-context-compass — mount smoke test.
 *
 * Mounts the built plugin the way the harness LOADER does (cordis-plugin-loader
 * unwrapExports: `module.default ?? module`, then `ctx.plugin(...)`) and
 * verifies the wiring: conditional registration of the projection unit / tool
 * / command through ctx.inject children, and live handler runs.
 *
 * Regression guard: the plugin default export MUST be an object with `apply`
 * (loader pitfall — a factory function default is called as the plugin body
 * and its returned `{ apply }` is silently ignored: no error, entry ACTIVE,
 * apply never runs). If apply does not run, the registrations below stay
 * null → this test fails.
 *
 *   npm run build && node scripts/mount.mjs
 */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'

const session = { header: { cwd: '/tmp/ws' } }
const registrations = { commands: null, tools: null, projections: null, routes: [] }

const ctx = new Context()
ctx.provide('tokenMeter', { measure: () => ({ totalTokens: 300_000 }) })
ctx.provide('llm', { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) })
ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) })
ctx.provide('sessions', { get: id => (id === 's1' ? session : undefined) })
ctx.provide('sandboxPolicy', { workspaceRoot: '/tmp/ws' })
// The overview scope is: top-level + non-archived (sidebar visibility).
ctx.provide('workspaceRegistry', { archivedSessionIds: ['other-ws'] })
ctx.provide('fs', {
  resolve: async p => p,
  stat: async p => (p === '.git' ? {} : undefined),
})
// Read-only git worktree probe fixture: clean worktree, synced branch.
const GIT_OUT = {
  'status --short': '',
  'log --oneline -1': '166f5ac feat: dsh-context-compass\n',
  'status -sb': '## main...origin/main\n',
}
ctx.provide('subprocess', {
  spawn: ({ argv }) => ({
    done: Promise.resolve({ exitCode: 0 }),
    collected: { stdout: { readFrom: () => ({ text: GIT_OUT[`${argv[1]} ${argv[2] ?? ''}`.trim()] ?? '' }) } },
  }),
})
ctx.provide('commands', { register: def => { registrations.commands = def } })
ctx.provide('tools', { register: tool => { registrations.tools = tool } })
ctx.provide('webServer', {
  register: route => {
    registrations.routes.push(route)
    return () => { /* dispose no-op */ }
  },
})
ctx.provide('sessionQuery', {
  listEvents: async () => [],
  listSessions: async () => [
    { header: { id: 's1', createdAt: 100, cwd: '/tmp/ws' }, live: true, persisted: true },
    { header: { id: 's2', createdAt: 200, cwd: '/tmp/ws' }, live: false, persisted: true },
    { header: { id: 'other-ws', createdAt: 300, cwd: '/elsewhere' }, live: false, persisted: true },
    { header: { id: 'sub', createdAt: 400, cwd: '/tmp/ws', origin: 'subagent' }, live: false, persisted: true },
  ],
  readTitleSnapshots: async ids => ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { title: { title: `标题-${id}` } } })),
})
ctx.provide('sessionProjectionCache', {
  cachedSnapshot: () => ({ values: { sessionHealth: { severity: 'yellow', advice: 'a', ratio: 0.6, total: 600_000, window: 1_000_000, turns: 1, userMessages: 1, assistantMessages: 0, compactions: 0, uncachedInputTokens: 600_000, cacheReadTokens: 0, effectivePerRound: 600_000, effectivePerRoundUsd: 0.168, effectivePerRoundCny: null, pricePeriod: null } } }),
  coldSnapshot: async () => undefined,
})
ctx.provide('sessionTitle', { get: () => undefined })
ctx.provide('sessionProjections', {
  register: def => { registrations.projections = def },
  // assess() reads usage buckets from the pushed snapshot — uncached 300K/round
  // on a 1M window hits the window-scaled economy floor (max(50K, 0.3×1M)).
  snapshot: () => ({
    values: {
      sessionHealth: {
        severity: 'yellow', advice: 'a', ratio: 0.3, total: 300_000, window: 1_000_000,
        turns: 0, userMessages: 0, assistantMessages: 0, compactions: 0,
        cacheHitRate: 0, uncachedInputTokens: 300_000, cacheReadTokens: 0,
        effectivePerRound: 300_000, effectivePerRoundUsd: 0.084, effectivePerRoundCny: null, pricePeriod: null,
      },
    },
  }),
})

// The exact loader normalization path (cordis-plugin-loader unwrapExports).
const mod = await import('../lib/index.js')
const plugin = mod.default ?? mod
assert.equal(typeof plugin, 'object', 'plugin must be an OBJECT, not a factory function')
assert.equal(typeof plugin.apply, 'function', 'plugin object must carry apply')
assert.equal(plugin.name, 'dsh-context-compass')
assert.ok(plugin.Config, 'plugin object must carry Config')

await ctx.plugin(plugin).await()
// Let the ctx.inject children (projection / tool / command) settle.
await new Promise(resolve => setTimeout(resolve, 50))

try {
  // 1) apply RAN (the loader-pitfall guard): the command registered.
  assert.ok(registrations.commands !== null, 'command registered (apply ran)')
  assert.equal(registrations.commands.name, 'compass')
  const result = await registrations.commands.handler({
    agent: { id: 'agent-1', session },
    rawInput: '',
    signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('健康度：**黄**'))
  assert.ok(result.text.includes('- [x] 未提交变更：0 个'), 'checklist commit item reflects the clean worktree')
  assert.ok(result.text.includes('- [x] 已 push：分支与远程同步'), 'checklist push item reflects the synced branch')
  console.log('  ok  apply ran: /compass command registered + handler runs')

  // 2) context_compass tool registered with a working execute.
  assert.ok(registrations.tools !== null, 'tool registered')
  assert.equal(registrations.tools.name, 'context_compass')
  const value = await registrations.tools.execute({}, {
    agent: { id: 'agent-1', session },
    signal: new AbortController().signal,
  })
  assert.equal(value.severity, 'yellow')
  assert.equal(value.recommendation, 'suggest-switch')
  console.log('  ok  context_compass tool registered + execute runs')

  // 3) sessionHealth projection unit registered (unit contract shape).
  assert.ok(registrations.projections !== null, 'projection registered')
  assert.equal(registrations.projections.key, 'sessionHealth')
  assert.equal(typeof registrations.projections.init, 'function')
  assert.equal(typeof registrations.projections.apply, 'function')
  assert.equal(typeof registrations.projections.view, 'function')
  const state = registrations.projections.init()
  const after = registrations.projections.apply(state, { type: 'step/end', data: { turn: 1 } })
  assert.equal(after.turns, 1)
  console.log('  ok  sessionHealth projection unit registered + fold works')

  // 4) Multi-session overview RPC route registered and serves sorted rows.
  const route = registrations.routes.find(r => r.path === '/context-compass-rpc')
  assert.ok(route, '/context-compass-rpc route registered via webServer')
  assert.equal(route.kind, 'exact')
  const res = { status: null, body: null, writeHead: (s) => { res.status = s }, end: (b) => { res.body = b } }
  const req = { method: 'POST', socket: { remoteAddress: '127.0.0.1' } }
  req[Symbol.asyncIterator] = async function* () { yield JSON.stringify({ method: 'overview' }) }
  await route.handler(req, res)
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  // Same tier (yellow): the LIVE session ranks first (方案 A), then newest.
  assert.deepEqual(payload.result.sessions.map(r => r.id), ['s1', 's2']) // top-level + non-archived, live first
  assert.equal(payload.result.sessions.length, 2, 'archived + subagent sessions are filtered out')
  assert.equal(payload.result.sessions[0].health.severity, 'yellow')     // cold session read the projection cache
  assert.equal(payload.result.sessions[0].title, null)                  // titles are background-filled after first paint
  assert.equal(payload.result.sessions[1].health.severity, 'yellow')     // live session cut the registry snapshot
  console.log('  ok  /context-compass-rpc route registered + overview handler runs (top-level + non-archived)')

  console.log('\nmount smoke passed')
  process.exit(0)
} catch (err) {
  console.error('mount smoke FAILED')
  console.error(err)
  process.exit(1)
}
