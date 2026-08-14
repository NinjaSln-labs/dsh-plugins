/**
 * dsh-session-health — mount smoke test.
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
const registrations = { commands: null, tools: null, projections: null }

const ctx = new Context()
ctx.provide('tokenMeter', { measure: () => ({ totalTokens: 132_000 }) })
ctx.provide('llm', { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) })
ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) })
ctx.provide('sessions', { get: id => (id === 's1' ? session : undefined) })
ctx.provide('sessionQuery', { listEvents: async () => [] })
ctx.provide('sandboxPolicy', { workspaceRoot: '/tmp/ws' })
ctx.provide('fs', {
  resolve: async p => p,
  stat: async p => (p === '.git' ? {} : undefined),
})
// Read-only git worktree probe fixture: clean worktree, synced branch.
const GIT_OUT = {
  'status --short': '',
  'log --oneline -1': '166f5ac feat: dsh-session-health\n',
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
ctx.provide('sessionProjections', { register: def => { registrations.projections = def } })

// The exact loader normalization path (cordis-plugin-loader unwrapExports).
const mod = await import('../lib/index.js')
const plugin = mod.default ?? mod
assert.equal(typeof plugin, 'object', 'plugin must be an OBJECT, not a factory function')
assert.equal(typeof plugin.apply, 'function', 'plugin object must carry apply')
assert.equal(plugin.name, 'dsh-session-health')
assert.ok(plugin.Config, 'plugin object must carry Config')

await ctx.plugin(plugin).await()
// Let the ctx.inject children (projection / tool / command) settle.
await new Promise(resolve => setTimeout(resolve, 50))

try {
  // 1) apply RAN (the loader-pitfall guard): the command registered.
  assert.ok(registrations.commands !== null, 'command registered (apply ran)')
  assert.equal(registrations.commands.name, 'health')
  const result = await registrations.commands.handler({
    agent: { id: 'agent-1', session },
    rawInput: '',
    signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('健康度：**黄**'))
  assert.ok(result.text.includes('- [x] 未提交变更：0 个'), 'checklist commit item reflects the clean worktree')
  assert.ok(result.text.includes('- [x] 已 push：分支与远程同步'), 'checklist push item reflects the synced branch')
  console.log('  ok  apply ran: /health command registered + handler runs')

  // 2) session_health tool registered with a working execute.
  assert.ok(registrations.tools !== null, 'tool registered')
  assert.equal(registrations.tools.name, 'session_health')
  const value = await registrations.tools.execute({}, {
    agent: { id: 'agent-1', session },
    signal: new AbortController().signal,
  })
  assert.equal(value.severity, 'yellow')
  assert.equal(value.recommendation, 'suggest-switch')
  console.log('  ok  session_health tool registered + execute runs')

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

  console.log('\nmount smoke passed')
  process.exit(0)
} catch (err) {
  console.error('mount smoke FAILED')
  console.error(err)
  process.exit(1)
}
