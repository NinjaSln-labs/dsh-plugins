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
  // 0.1.1+ wire 契约：client-visible unit 用 wire.view（旧独立 view 字段已移除）。
  assert.ok(registrations.projections.wire, 'projection wire present (client-visible)')
  assert.equal(typeof registrations.projections.wire.view, 'function')
  const state = registrations.projections.init()
  const after = registrations.projections.apply(state, { type: 'step/end', data: { turn: 1 } })
  assert.equal(after.turns, 1)
  console.log('  ok  sessionHealth projection unit registered + fold works')

  // 4) Multi-session overview RPC route registered and serves sorted rows.
  const route = registrations.routes.find(r => r.path === '/context-compass-rpc')
  assert.ok(route, '/context-compass-rpc route registered via webServer')
  assert.equal(route.kind, 'exact')
  const res = { status: null, body: null, writeHead: (s) => { res.status = s }, end: (b) => { res.body = b } }
  // Host header required by the AUDIT OV-3 loopback-Host check.
  const req = { method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' } }
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

  // 5) S3（ROADMAP 0.8.0）：projection.enabled=false → 投影单元不注册（接线
  // 开关可观测），工具/命令/RPC 不受影响。独立 Context + 同套 stub（去掉
  // sessionProjections——禁用后 inject 根本不应发生）。
  const offCtx = new Context()
  offCtx.provide('tokenMeter', { measure: () => ({ totalTokens: 300_000 }) })
  offCtx.provide('llm', { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) })
  offCtx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) })
  offCtx.provide('sandboxPolicy', { workspaceRoot: '/tmp/ws' })
  offCtx.provide('workspaceRegistry', { archivedSessionIds: [] })
  offCtx.provide('fs', { resolve: async p => p, stat: async () => undefined })
  offCtx.provide('subprocess', { spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text: '' }) } } }) })
  offCtx.provide('commands', { register: () => {} })
  offCtx.provide('tools', { register: () => {} })
  offCtx.provide('webServer', { register: () => () => {} })
  offCtx.provide('sessionQuery', { listEvents: async () => [], listSessions: async () => [] })
  offCtx.provide('sessionProjectionCache', { cachedSnapshot: () => ({ values: {} }), coldSnapshot: async () => undefined })
  offCtx.provide('sessionTitle', { get: () => undefined })
  const offRegs = { projections: null }
  offCtx.provide('sessionProjections', { register: def => { offRegs.projections = def }, snapshot: () => ({ values: {} }) })
  await offCtx.plugin(plugin, { projection: { enabled: false } }).await()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(offRegs.projections, null, 'projection.enabled=false must skip the projection registration')
  console.log('  ok  projection.enabled=false skips the projection unit (config wiring observable)')

  // 6) C1（docs/C1-SETTINGS-DESIGN.md）：settings 服务挂载 → 注册 ns
  // 'context-compass'（base=entry）；settings 写入 → source 切换 → 工具行为
  // live 变化；validate 拒绝非单调阈值。独立 Context + 同套 stub + fake settings。
  const c1Ctx = new Context()
  c1Ctx.provide('tokenMeter', { measure: () => ({ totalTokens: 300_000 }) })
  c1Ctx.provide('llm', { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) })
  c1Ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) })
  c1Ctx.provide('sandboxPolicy', { workspaceRoot: '/tmp/ws' })
  c1Ctx.provide('workspaceRegistry', { archivedSessionIds: [] })
  c1Ctx.provide('fs', { resolve: async p => p, stat: async p => (p === '.git' ? {} : undefined) })
  c1Ctx.provide('subprocess', { spawn: () => ({ done: Promise.resolve({ exitCode: 0 }), collected: { stdout: { readFrom: () => ({ text: '' }) } } }) })
  const c1Regs = { tools: null }
  c1Ctx.provide('commands', { register: () => {} })
  c1Ctx.provide('tools', { register: tool => { c1Regs.tools = tool } })
  c1Ctx.provide('webServer', { register: () => () => {} })
  c1Ctx.provide('sessionQuery', { listEvents: async () => [], listSessions: async () => [] })
  c1Ctx.provide('sessionProjectionCache', { cachedSnapshot: () => ({ values: {} }), coldSnapshot: async () => undefined })
  c1Ctx.provide('sessionTitle', { get: () => undefined })
  c1Ctx.provide('sessionProjections', { register: () => () => {}, snapshot: () => ({ values: {} }) })
  const fake = {
    registered: null, watchCb: null, value: null,
    register(ns, schema, opts) {
      fake.registered = { ns, schema, opts }
      fake.value = schema({ ...(opts.base ?? {}) })
      return {
        get: () => fake.value,
        watch: cb => { fake.watchCb = cb; return () => {} },
      }
    },
    // 模拟一次 settings 写入：schema 解析 → 提交 → watch 推送。
    async write(patch) {
      fake.value = fake.registered.schema({ ...fake.value, ...patch })
      fake.watchCb?.(fake.value, fake.value)
    },
  }
  c1Ctx.provide('settings', fake)
  await c1Ctx.plugin(plugin).await()
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(fake.registered, 'settings namespace registered while the service is mounted')
  assert.equal(fake.registered.ns, 'context-compass', 'ns is the plugin short name')
  assert.equal(typeof fake.registered.opts.validate, 'function', 'cross-field validate wired')
  // validate：非单调阈值在写入口被拒（schema 表达不了的跨字段约束）。
  assert.throws(
    () => fake.registered.opts.validate(fake.registered.schema({ thresholds: { windowMid: 0.9, windowHigh: 0.5, windowCritical: 0.8 } })),
    /单调递增/,
  )
  // live 写入：windowHigh 0.5 → 0.25，30% 占比从蓝升黄（无重启、无重挂）。
  // （c1Ctx 投影快照为空 → assess 走 tokenMeter 路径：300K/1M = 30%。）
  assert.equal(c1Regs.tools !== null, true, 'tool registered on the settings-mounted context')
  const c1Before = await c1Regs.tools.execute({}, { agent: { id: 'agent-1', session }, signal: new AbortController().signal })
  assert.equal(c1Before.severity, 'blue')
  await fake.write({ thresholds: { ...fake.value.thresholds, windowHigh: 0.25 } })
  const c1After = await c1Regs.tools.execute({}, { agent: { id: 'agent-1', session }, signal: new AbortController().signal })
  assert.equal(c1After.severity, 'yellow', 'a settings write must reach the tool live (getter mode)')
  console.log('  ok  settings ns registered + live write reaches the tool + validate refuses non-monotonic ladder')

  console.log('\nmount smoke passed')
  process.exit(0)
} catch (err) {
  console.error('mount smoke FAILED')
  console.error(err)
  process.exit(1)
}
