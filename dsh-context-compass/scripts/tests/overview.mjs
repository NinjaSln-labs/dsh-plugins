/**
 * Smoke domain: multi-session overview — buildOverview/sort, title & cold-load
 * caches, the overview/summary RPC handlers. Checks moved verbatim from the
 * monolith (L1138-1511); fixtures healthOf/overviewServices/overviewCtx/
 * fakeRes/fakeReq live in helpers.mjs.
 */
import assert from 'node:assert/strict'
import { buildOverview, sortOverviewRows, rankOf, clearTitleCache, handleOverviewRpc, buildHandoffSummary, __resetOverviewCachesForTests } from '../../lib/overview.js'
import {
  check, config, signal, services, overviewCtx, overviewServices,
  healthOf, fakeRes, fakeReq,
} from './helpers.mjs'

export async function run() {
  await check('overview: snapshot / cache / cold fallback + titles + severity sort', async () => {
    __resetOverviewCachesForTests()
    const { rows: rows } = await buildOverview(overviewCtx, signal)
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
    __resetOverviewCachesForTests()
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
    __resetOverviewCachesForTests()
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
    const { rows: rows } = await buildOverview(agentsCtx, signal)
    assert.equal(rows[0].status, 'running')  // agent running → 运行中
    assert.equal(rows[1].status, 'cold')     // source live:false + no agent → cold
    assert.equal(rows[2].status, 'loaded')   // agent idle → loaded
    assert.equal(rows[3].status, 'cold')
  })

  await check('overview: activity sort — running > loaded > cold inside a tier', () => {
    __resetOverviewCachesForTests()
    const rows = sortOverviewRows([
      { id: 'idle', title: null, status: 'loaded', createdAt: 100, health: healthOf('green') },
      { id: 'running', title: null, status: 'running', createdAt: 300, health: healthOf('green') },
      { id: 'old-run', title: null, status: 'running', createdAt: 200, health: healthOf('green') },
      { id: 'cold', title: null, status: 'cold', createdAt: 400, health: healthOf('green') },
    ])
    // Running (newest first) → loaded → cold, all same green tier.
    assert.deepEqual(rows.map(r => r.id), ['running', 'old-run', 'idle', 'cold'])
  })

  await check('overview: sort — running 置顶（跨 severity tier，2026-08-22 反馈）', () => {
    __resetOverviewCachesForTests()
    const rows = sortOverviewRows([
      // 冷却+红（严重度高）曾排在 运行中+绿 前面——运行中必须永远在最上。
      { id: 'red-cold', title: null, status: 'cold', createdAt: 500, health: healthOf('red') },
      { id: 'yellow-loaded', title: null, status: 'loaded', createdAt: 400, health: healthOf('yellow') },
      { id: 'running-green', title: null, status: 'running', createdAt: 100, health: healthOf('green') },
    ])
    assert.deepEqual(rows.map(r => r.id), ['running-green', 'red-cold', 'yellow-loaded'])
  })

  await check('overview: absent sessionQuery degrades to empty list', async () => {
    __resetOverviewCachesForTests()
    assert.deepEqual((await buildOverview({ get: () => undefined }, signal)).rows, [])
  })

  await check('overview: 单次空结果不覆盖缓存，连续两次空采信清空（AUDIT OV-1 幽灵列表自愈）', async () => {
    __resetOverviewCachesForTests()
    // 先有 1 个会话的缓存。
    const fullCtx = {
      get: name => ({
        ...overviewServices,
        sessionQuery: { listSessions: async () => [{ header: { id: 'a', createdAt: 1 }, live: false, persisted: true }], readTitleSnapshots: async () => [] },
      })[name],
    }
    const first = await buildOverview(fullCtx, signal)
    assert.equal(first.rows.length, 1)
    // 等 TTL 过期——SWR 后台刷新只在过期帧发起（幽灵场景：有过数据 → 过期 → 刷新拿空）。
    await new Promise(resolve => setTimeout(resolve, 6200))
    const emptyCtx = {
      get: name => ({
        ...overviewServices,
        sessionQuery: { listSessions: async () => [], readTitleSnapshots: async () => [] },
      })[name],
    }
    const jitter = await buildOverview(emptyCtx, signal)
    assert.equal(jitter.rows.length, 1, 'single empty read must not clear the cached list')
    await new Promise(resolve => setTimeout(resolve, 60)) // 后台刷新落定（streak=1）
    const second = await buildOverview(emptyCtx, signal)
    assert.equal(second.rows.length, 1, 'second empty frame still serves the stale list (streak not yet trusted)')
    await new Promise(resolve => setTimeout(resolve, 60)) // 第二次刷新落定（streak=2 → 采信清空）
    const cleared = await buildOverview(emptyCtx, signal)
    assert.equal(cleared.rows.length, 0, 'two consecutive empty reads must heal the ghost list')
  })

  await check('overview: top-level + archive filtering matches the sidebar', async () => {
    __resetOverviewCachesForTests()
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
    const { rows: rows } = await buildOverview({ get: name => wsServices[name] }, signal)
    assert.deepEqual(rows.map(r => r.id), ['no-cwd', 'in-ws']) // archived + subagent out, newest first
  })

  await check('overview: cold loads run OFF the request path — first frame null, next frame backfilled', async () => {
    __resetOverviewCachesForTests()
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
    // First frame: cold load is scheduled in the background — the row reads
    // health:null THIS frame and buildOverview does NOT wait for the disk IO.
    const t0 = Date.now()
    const { rows: rows } = await buildOverview(slowCtx, signal)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].health, null) // background load not awaited
    assert.ok(Date.now() - t0 < 20, `first frame must not wait the ${Date.now() - t0}ms cold IO`)
    // Next frame (after the 20ms background load lands): TTL cache serves it.
    await new Promise(resolve => setTimeout(resolve, 60))
    const { rows: rows2 } = await buildOverview(slowCtx, signal)
    assert.equal(rows2[0].health?.severity, 'blue') // backfilled from cache
  })

  await check('overview: archived sessions are hidden everywhere', async () => {
    __resetOverviewCachesForTests()
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
    const { rows: rows } = await buildOverview(archivedCtx, signal)
    assert.deepEqual(rows.map(r => r.id), ['a1'])
  })

  await check('overview: workspaceRegistry.list() throwing degrades to ungrouped rows', async () => {
    __resetOverviewCachesForTests()
    // A workspace registry whose list()/archivedSessionIds access throws must NOT
    // blank the panel — archive cut is skipped and rows stay ungrouped, never throw.
    const wsbCtx = {
      get: name => ({
        ...overviewServices,
        workspaceRegistry: {
          archivedSessionIds: new Proxy({}, { get: () => { throw new Error('archived boom') } }),
          list: () => { throw new Error('list boom') },
        },
      })[name],
    }
    const { rows: rows } = await buildOverview(wsbCtx, signal)
    assert.equal(rows.length, 4) // nothing archived → all rows present
    assert.ok(rows.every(r => r.workspace === null)) // ungrouped, never thrown
  })

  await check('overview: title cache — first frame null, background fill, next hit', async () => {
    __resetOverviewCachesForTests()
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
    const { rows: first } = await buildOverview(titleCtx, signal)
    assert.equal(first.length, 1)
    assert.equal(first[0].title, null) // cache miss: no log read on first paint
    await new Promise(resolve => setTimeout(resolve, 50)) // background fill settles
    const { rows: second } = await buildOverview(titleCtx, signal)
    assert.equal(second[0].title, 'T-t1') // cache hit on the next frame
    clearTitleCache()
  })

  await check('overview: one broken record degrades that row only', async () => {
    __resetOverviewCachesForTests()
    const brokenCtx = {
      get: name => ({
        ...overviewServices,
        sessionProjections: { snapshot: () => { throw new Error('boom') } },
        sessionProjectionCache: { cachedSnapshot: () => { throw new Error('boom') }, coldSnapshot: async () => { throw new Error('boom') } },
      })[name],
    }
    const { rows: rows } = await buildOverview(brokenCtx, signal)
    assert.equal(rows.length, 4)
    assert.ok(rows.every(r => r.health === null)) // per-record failures degrade, never throw
  })

  await check('overview: title-backend failures (readTitleSnapshots + sessionTitle) degrade silently', async () => {
    __resetOverviewCachesForTests()
    // scheduleTitleFill 的 readTitleSnapshots 抛错 + sessionTitle.get 抛错：
    // 标题降级 null（下一帧重试），health 也正常降级——绝不向上抛导致面板白屏。
    clearTitleCache()
    const titleBoomCtx = {
      get: name => ({
        ...overviewServices,
        sessionQuery: {
          listSessions: async () => [{ header: { id: 't-boom', createdAt: 1 }, live: false, persisted: true }],
          readTitleSnapshots: async () => { throw new Error('title read boom') },
        },
        sessionTitle: { get: () => { throw new Error('title get boom') } },
      })[name],
    }
    const { rows: rows } = await buildOverview(titleBoomCtx, signal)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].title, null) // degraded, never thrown
    clearTitleCache()
  })

  /* ---------- overview RPC handler ---------- */
  await check('overview rpc: POST overview → 200 + sorted sessions', async () => {
    __resetOverviewCachesForTests()
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

  await check('overview rpc: loopback 地址 + 非 loopback Host → 403（AUDIT OV-2/OV-3，防 DNS rebinding）', async () => {
    const res = fakeRes()
    const req = fakeReq('POST', '{}', '127.0.0.1')
    req.headers.host = 'evil.example.com'
    await handleOverviewRpc(req, res, overviewCtx, config)
    assert.equal(res.out.status, 403)
  })

  await check('overview rpc: 缺失 remoteAddress → 403 fail-closed（AUDIT OV-2）', async () => {
    const res = fakeRes()
    const req = fakeReq('POST', '{}', undefined)
    await handleOverviewRpc(req, res, overviewCtx, config)
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

  await check('overview rpc: service failure → 500 with error message (never a hang)', async () => {
    // buildOverview 内部全 catch 降级，500 路径由 summary 的 assess 触发——
    // 用抛错的 tokenMeter 模拟（assess 的 measureTokens catch 了？不——这里
    // 用 summary 路径的 sessions.get 抛错验证 catch → 500）。
    const boomCtx = {
      get: name => name === 'sessions'
        ? { get: () => { throw new Error('boom') } }
        : name === 'agents'
          ? { get: () => ({ id: 'agent-1' }) }
          : overviewServices[name],
    }
    const res = fakeRes()
    await handleOverviewRpc(fakeReq('POST', JSON.stringify({ method: 'summary', sessionId: 'x' }), '127.0.0.1'), res, boomCtx, config)
    assert.equal(res.out.status, 500)
    assert.equal(JSON.parse(res.out.body).ok, false)
    assert.equal(JSON.parse(res.out.body).error, 'boom')
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

  await check('summary: buildHandoffSummary clamps pct to 100 when ratio > 1', () => {
    const text = buildHandoffSummary({
      severity: 'red',
      recommendation: 'suggest-switch',
      summary: '尽快收尾',
      reason: '',
      signals: {
        total: 1_500_000, window: 1_000_000, ratio: 1.5, // 150% → must show 100%
        turns: 20, userMessages: 25, assistantMessages: 24,
        compactions: 0, compactionRatio: null,
      },
      probes: [],
      handoff: { isGitRepo: null, hasHandoff: null, runningProcesses: [], processesChecked: false, clean: null, uncommittedCount: null, lastCommit: null, branchLine: null },
    })
    assert.ok(text.includes('（窗口 100%）')) // clamped, never 150%
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
}
