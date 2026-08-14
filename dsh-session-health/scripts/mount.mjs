/**
 * dsh-session-health — mount smoke test.
 *
 * Mounts the built plugin in a REAL cordis Context with stub services and
 * verifies the wiring: Remote service provision, conditional registration of
 * the projection unit / tool / command through ctx.inject children, and a
 * live healthState RPC call.
 *
 *   npm run build && node scripts/mount.mjs
 */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import sessionHealthHost, { SessionHealthService } from '../lib/index.js'

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
ctx.provide('subprocess', undefined)
ctx.provide('commands', { register: def => { registrations.commands = def } })
ctx.provide('tools', { register: tool => { registrations.tools = tool } })
ctx.provide('sessionProjections', { register: def => { registrations.projections = def } })

const plugin = sessionHealthHost({})
await ctx.plugin(plugin).await()
// Let the ctx.inject children (projection / tool / command) settle.
await new Promise(resolve => setTimeout(resolve, 50))

try {
  // 1) Remote service is provided and callable.
  const service = ctx.get('sessionHealth')
  assert.ok(service instanceof SessionHealthService, 'ctx.sessionHealth is the Remote service')
  const health = await service.healthState({ sessionId: 's1' })
  assert.equal(health.color, 'yellow') // 132K >= 50K economy floor
  assert.equal(health.total, 132_000)
  assert.equal(health.window, 1_000_000)
  console.log('  ok  Remote service provided + healthState RPC')

  // 2) /health command registered.
  assert.ok(registrations.commands !== null, 'command registered')
  assert.equal(registrations.commands.name, 'health')
  const result = await registrations.commands.handler({
    agent: { id: 'agent-1', session },
    rawInput: '',
    signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'success')
  assert.ok(result.text.includes('健康度：**黄**'))
  console.log('  ok  /health command registered + handler runs')

  // 3) session_health tool registered with a working execute.
  assert.ok(registrations.tools !== null, 'tool registered')
  assert.equal(registrations.tools.name, 'session_health')
  const value = await registrations.tools.execute({}, {
    agent: { id: 'agent-1', session },
    signal: new AbortController().signal,
  })
  assert.equal(value.severity, 'yellow')
  assert.equal(value.recommendation, 'suggest-switch')
  console.log('  ok  session_health tool registered + execute runs')

  // 4) sessionHealth projection unit registered (unit contract shape).
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
