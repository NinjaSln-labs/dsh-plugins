/**
 * dsh-context-compass — multi-session overview (panel data).
 *
 * Host side of the 上下文罗盘一览面板: one read-only snapshot of the
 * current workspace's top-level sessions for the browser panel
 * (`sidebar.footer.action` opens it, `shell.overlay` renders it).
 *
 * Scope mirrors the sidebar exactly: top-level sessions (subagent children
 * excluded) that are not archived (`workspaceRegistry.archivedSessionIds` —
 * the registry-global archive set every grouping surface hides).
 *
 * LATENCY: the panel must open fast. The two expensive reads — cold
 * projection loads and title folds (both read the session log) — are
 * handled so the first frame never waits on a log read:
 * - cold projection loads run in parallel and backfill in place
 * - titles come from the live in-memory fold or a short-TTL in-memory
 *   cache; cache misses return null this frame and a BACKGROUND fill
 *   (bound to the request's abort scope — once the panel closes the fill
 *   has no consumer left) populates the cache, so the panel's 5s refresh
 *   shows titles moments later
 *
 * Transport: same-origin JSON RPC (POST /context-compass-rpc, loopback-only),
 * the same pattern dsh-imgdraw established for bundle clients — a bundle
 * client cannot expose a plugin Remote, so browser↔host calls ride the
 * webServer route seam.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HealthSeverity, SessionActivity, SessionHealthProjection } from './types.ts'
import type { HealthReport } from './assess.ts'
import type { Session } from '@deepseek-ai/dsh-session'
import { assess } from './assess.ts'
import type { ResolvedConfig } from './config.ts'
import { formatCompact, formatHitRate } from './util.ts'

/** One session row in the overview panel. */
export interface OverviewRow {
  id: string
  /** Best-known title; null when no title event exists yet (or still loading). */
  title: string | null
  /**
   * Real activity: `running` = the session's Agent lifecycle status is
   * `running` (actively processing a turn — the sidebar's 进行中 signal);
   * `loaded` = materialized in ctx.sessions but idle; `cold` = persisted
   * only. NOT the old `live` flag (that meant mere in-memory presence).
   */
  status: SessionActivity
  /** Session creation time (Unix epoch ms) — secondary sort key. */
  createdAt: number
  /** The health verdict; null when no projection value exists (cold + no cache row). */
  health: SessionHealthProjection | null
  /** Owning workspace (display title); null when the session is ungrouped. */
  workspace: { id: string; title: string } | null
}

const SEVERITY_RANK: Record<HealthSeverity, number> = { red: 0, yellow: 1, blue: 2, green: 3 }

/** Sort rank: red first, then yellow / blue / green, unknown last. */
export function rankOf(health: SessionHealthProjection | null | undefined): number {
  if (health === undefined || health === null) return 4
  return SEVERITY_RANK[health.severity] ?? 4
}

/** Activity sort rank: running first, then loaded, then cold. */
function activityRank(status: SessionActivity | null | undefined): number {
  return status === 'running' ? 0 : status === 'loaded' ? 1 : 2
}

/**
 * Stable sort (agreed priority — 方案 A): severity tier first (red on top),
 * then REAL activity (running agents burning tokens now > loaded/idle >
 * cold — the ones the user cares about), then newest-created first inside a
 * tier. The old sort by `live` (in-memory presence) ranked idle sessions
 * above genuinely running ones in other states and is gone.
 */
export function sortOverviewRows(rows: OverviewRow[]): OverviewRow[] {
  return [...rows].sort((a, b) => {
    const ra = rankOf(a.health)
    const rb = rankOf(b.health)
    if (ra !== rb) return ra - rb
    const aa = activityRank(a.status)
    const ab = activityRank(b.status)
    if (aa !== ab) return aa - ab
    return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })
}

/** Loose face of the sessionQuery service (only the parts overview needs). */
interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<Array<{
    header: { id: string; createdAt?: number; origin?: string }
    live?: boolean
    persisted?: boolean
  }>>
  readTitleSnapshots(
    sessionIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<Array<{
    sessionId: string
    status: 'fulfilled' | 'rejected'
    value?: { title?: { title: string } }
  }>>
}

/** Loose face of the in-memory session store (live sessions). */
interface SessionsStoreLike {
  get(id: string): { header?: { id?: string } } | undefined
}

/**
 * Short-TTL in-memory title cache. Title folds read the whole session log,
 * which is the dominant cost of an overview request; the cache lets the
 * first frame skip every log read and the background fill (see below)
 * populate it seconds later. TTL keeps renames/misses fresh on the 5s
 * panel refresh cadence.
 */
const titleCache = new Map<string, { title: string; at: number }>()
const TITLE_TTL_MS = 60_000

/** Forget the cache (tests / plugin re-apply). */
export function clearTitleCache(): void {
  titleCache.clear()
}

/**
 * Background title fill: read the batch and populate the cache. The fill is
 * deliberately bound to the REQUEST's signal (not a fresh one): once the
 * request is aborted (panel closed / component unmounted) the fill has no
 * consumer left, so cancelling it avoids pointless log reads. Failures stay
 * silent — the next refresh retries. Fire-and-forget.
 */
function scheduleTitleFill(ctx: Context, ids: string[], fillSignal: AbortSignal): void {
  if (ids.length === 0) return
  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike | undefined
  if (sessionQuery?.readTitleSnapshots === undefined) return
  const controller = new AbortController()
  fillSignal.addEventListener('abort', () => controller.abort(), { once: true })
  const promise = (async () => {
    try {
      const observations = await sessionQuery.readTitleSnapshots(ids, controller.signal)
      for (const o of observations) {
        if (o.status !== 'fulfilled') continue
        const t = o.value?.title?.title
        if (typeof t === 'string' && t !== '') titleCache.set(o.sessionId, { title: t, at: Date.now() })
      }
    } catch { /* next refresh retries */ }
  })()
  void promise
}

/**
 * Build the overview rows: top-level (non-subagent), non-archived sessions.
 * Never throws on a single bad session — per-record failures degrade to
 * `health: null` / `title: null` so one broken record cannot blank the whole
 * panel. Returns [] when the sessionQuery service is absent (headless
 * assemblies keep working).
 */
export async function buildOverview(ctx: Context, signal: AbortSignal): Promise<OverviewRow[]> {
  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike | undefined
  if (sessionQuery === undefined) return []

  let records: Array<{ header: { id: string; createdAt?: number; origin?: string }; live?: boolean; persisted?: boolean }>
  try {
    records = await sessionQuery.listSessions(signal)
  } catch {
    return []
  }
  if (!Array.isArray(records) || records.length === 0) return []

  // Archived sessions are hidden from every sidebar grouping surface; the
  // panel mirrors that (workspace accounting keeps them, visibility drops).
  const workspaceRegistry = ctx.get('workspaceRegistry') as
    | {
        archivedSessionIds?: readonly string[]
        list?(): Array<{ id: string; path?: string; title?: string; sessionIds?: readonly string[] }>
      }
    | undefined
  let archived: ReadonlySet<string> | null = null
  try {
    const ids = workspaceRegistry?.archivedSessionIds
    if (Array.isArray(ids)) archived = new Set(ids)
  } catch { /* no archive cut */ }
  // Session → workspace display map (title ?? path basename). A session can
  // appear in several workspace accounts in principle; first match wins.
  const workspaceBySession = new Map<string, { id: string; title: string }>()
  try {
    for (const w of workspaceRegistry?.list?.() ?? []) {
      const title = (typeof w.title === 'string' && w.title !== '')
        ? w.title
        : (w.path ?? '').split(/[\\/]/).filter(Boolean).pop() ?? w.id
      for (const sid of w.sessionIds ?? []) {
        if (!workspaceBySession.has(sid)) workspaceBySession.set(sid, { id: w.id, title })
      }
    }
  } catch { /* rows stay ungrouped */ }

  const sessionsStore = ctx.get('sessions') as SessionsStoreLike | undefined
  const projections = ctx.get('sessionProjections') as
    | { snapshot(session: unknown): { values?: Record<string, unknown> } }
    | undefined
  const cache = ctx.get('sessionProjectionCache') as
    | {
        cachedSnapshot(meta: { id: string }): { values?: Record<string, unknown> } | undefined
        coldSnapshot?(id: string, signal?: AbortSignal): Promise<{ values?: Record<string, unknown> }>
      }
    | undefined
  const titleSvc = ctx.get('sessionTitle') as
    | { get(session: unknown): { title?: string } | undefined }
    | undefined
  // Real activity signal: the Agent registry. `agents.get(id)?.status ===
  // 'running'` is the genuine "actively processing" state (the sidebar's
  // 进行中 marker). Absent service (headless assembly) → never report
  // running; fall back to loaded/cold from the session-store presence.
  const agents = ctx.get('agents') as
    | { get(id: string): { status?: 'idle' | 'running' } | undefined }
    | undefined

  const rows: OverviewRow[] = []
  // Cold projection loads are a slow path (per-session disk reads): collect
  // them and run them in PARALLEL instead of serially awaiting each one.
  const coldLoads: Array<{ id: string; promise: Promise<SessionHealthProjection | null> }> = []
  // Title cache misses: filled in the background, never awaited this frame.
  const titleMisses: string[] = []
  const now = Date.now()

  for (const rec of records) {
    const id = rec.header?.id
    if (typeof id !== 'string' || id === '') continue
    // The sidebar lists top-level sessions only: subagent children and
    // archived sessions stay out.
    if (rec.header.origin === 'subagent') continue
    if (archived !== null && archived.has(id)) continue
    const createdAt = typeof rec.header.createdAt === 'number' ? rec.header.createdAt : 0

    // Health value: live projection snapshot first, then the persisted cache
    // (sync read), then an async cold load for a persisted session.
    let health: SessionHealthProjection | null = null
    const liveSession = rec.live === true ? sessionsStore?.get(id) : undefined
    if (liveSession !== undefined && projections !== undefined) {
      try {
        const values = projections.snapshot(liveSession).values ?? {}
        const value = values.sessionHealth as SessionHealthProjection | undefined
        if (value !== undefined && value !== null) health = value
      } catch { /* fall through to the cache */ }
    }
    if (health === null && cache !== undefined) {
      try {
        const snap = cache.cachedSnapshot(rec.header)
        const value = snap?.values?.sessionHealth as SessionHealthProjection | undefined
        if (value !== undefined && value !== null) health = value
      } catch { /* fall through to cold load */ }
    }
    if (health === null && cache?.coldSnapshot !== undefined && rec.persisted === true) {
      coldLoads.push({
        id,
        promise: cache.coldSnapshot(id, signal)
          .then(snap => {
            const value = snap?.values?.sessionHealth as SessionHealthProjection | undefined
            return value !== undefined && value !== null ? value : null
          })
          .catch(() => null),
      })
    }

    // Title: live log-backed fold (in-memory, fast) first, then the cache.
    // A miss returns null THIS frame and schedules a background fill — the
    // panel's 5s refresh picks the title up without ever blocking first
    // paint on a log read.
    let title: string | null = null
    if (liveSession !== undefined && titleSvc !== undefined) {
      try { title = titleSvc.get(liveSession)?.title ?? null } catch { /* cache below */ }
    }
    if (title === null) {
      const cached = titleCache.get(id)
      if (cached !== undefined && now - cached.at < TITLE_TTL_MS) {
        title = cached.title
      } else {
        titleMisses.push(id)
      }
    }

    // Activity: running agent > loaded (in memory, idle) > cold (persisted).
    // `agents.get` is a registry lookup, cheap per row; guarded per session.
    let status: SessionActivity = rec.live === true ? 'loaded' : 'cold'
    if (agents !== undefined) {
      try {
        if (agents.get(id)?.status === 'running') status = 'running'
      } catch { /* fall back to loaded/cold */ }
    }

    rows.push({
      id,
      title,
      status,
      createdAt,
      health,
      workspace: workspaceBySession.get(id) ?? null,
    })
  }

  // Parallel cold loads, then backfill in place (fast path: most sessions
  // are served by the sync cachedSnapshot and this list stays empty).
  if (coldLoads.length > 0) {
    const byId = new Map(rows.map(r => [r.id, r]))
    const settled = await Promise.all(coldLoads.map(c => c.promise))
    for (let i = 0; i < coldLoads.length; i++) {
      const row = byId.get(coldLoads[i].id)
      if (row !== undefined && settled[i] !== null) row.health = settled[i]
    }
  }

  // Background title fill (never awaited; fresh signal, own abort scope).
  if (titleMisses.length > 0) scheduleTitleFill(ctx, titleMisses, signal)

  return sortOverviewRows(rows)
}

/** Loopback-only guard for the RPC route (the panel data stays on the machine). */
function isLoopback(req: IncomingMessage): boolean {
  const addr = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress
  if (addr === undefined) return true
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/** RPC body 上限：请求极小（method + sessionId），16KB 防御恶意大 body OOM。 */
const MAX_BODY_BYTES = 16 * 1024

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error('request body too large'), { status: 413 })
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** RPC request shape from the browser panel. */
interface RpcCall {
  method?: string
  sessionId?: string
}

/** 摘要文本的最大长度（防御超长报告）。 */
const SUMMARY_MAX_LEN = 2000

/**
 * Build the copy-ready handoff summary for one session — plain text, one
 * line per fact, no markdown. Consumed by the badge tooltip's 复制交接摘要
 * action (B3). Uses the same read-only assess() core so the git / handoff
 * checklist state is real, not invented.
 */
export function buildHandoffSummary(report: HealthReport): string {
  const s = report.signals
  const h = report.handoff
  const pct = s.ratio !== null ? Math.min(Math.round(s.ratio * 100), 100) : null
  const lines: string[] = ['上下文罗盘摘要', '—']
  lines.push(`健康度：${report.severity}（${report.summary}）`)
  if (typeof s.turns === 'number') {
    lines.push(`会话规模：${s.turns} 轮 / ${(s.userMessages ?? 0) + (s.assistantMessages ?? 0)} 条消息`)
  }
  if (s.total !== null) {
    lines.push(`每轮输入：约 ${formatCompact(s.total)} token${pct !== null ? `（窗口 ${pct}%）` : ''}`)
  }
  if (typeof s.cacheHitRate === 'number') {
    lines.push(`缓存命中：${formatHitRate(s.cacheHitRate)}`)
  }
  if (typeof s.compactions === 'number' && s.compactions > 0) {
    // isFinite：与 tool.ts/command.ts 的 compactionRatio 守卫对齐（纵深防御）。
    const ratio = typeof s.compactionRatio === 'number' && Number.isFinite(s.compactionRatio)
      ? `（上次压缩比例 ≈ ${Math.round(s.compactionRatio * 100)}%）`
      : ''
    lines.push(`已压缩：${s.compactions} 次${ratio}`)
  }
  if (h.uncommittedCount !== null) lines.push(`未提交变更：${h.uncommittedCount} 个`)
  if (h.hasHandoff !== null) lines.push(`交接文档：${h.hasHandoff ? '已就位' : '未找到'}`)
  if (h.lastCommit !== null) lines.push(`最新 commit：${h.lastCommit}`)
  // push 状态（ahead/behind）也是交接清单的真实部分——未 push 的提交在切换
  // 前需推送，B3 规格要求「git 状态」。
  if (h.branchLine !== null) lines.push(`分支：${h.branchLine}`)
  lines.push(`时间：${new Date().toISOString()}`)
  return lines.join('\n').slice(0, SUMMARY_MAX_LEN)
}

/**
 * Full HTTP handler for POST /context-compass-rpc. Methods:
 *   { method: 'overview' } → { ok: true, result: { sessions: OverviewRow[] } }
 *   { method: 'summary', sessionId } → { ok: true, result: { text } }
 * Loopback-only (panel data is private to the machine); 405 on non-POST,
 * 400 on malformed JSON, 403 on non-loopback peers, 500 on service failure.
 */
export async function handleOverviewRpc(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Context,
  config: ResolvedConfig,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'POST only' })
    return
  }
  if (!isLoopback(req)) {
    sendJson(res, 403, { ok: false, error: 'loopback only' })
    return
  }
  let call: RpcCall
  try {
    call = JSON.parse(await readBody(req)) as RpcCall
  } catch (e) {
    // body 超限 → 413；其余（非法 JSON）→ 400。
    const status = e instanceof Error && (e as { status?: number }).status === 413 ? 413 : 400
    sendJson(res, status, { ok: false, error: status === 413 ? 'request body too large' : 'invalid json' })
    return
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    if (call.method === 'overview') {
      const sessions = await buildOverview(ctx, controller.signal)
      sendJson(res, 200, { ok: true, result: { sessions } })
      return
    }
    if (call.method === 'summary') {
      const sessionId = call.sessionId
      if (typeof sessionId !== 'string' || sessionId === '') {
        sendJson(res, 400, { ok: false, error: 'sessionId required' })
        return
      }
      const sessions = ctx.get('sessions') as { get(id: string): unknown } | undefined
      const agents = ctx.get('agents') as { get(id: string): { id: string } | undefined } | undefined
      const session = sessions?.get(sessionId) as Session | undefined
      const agent = agents?.get(sessionId)
      if (session === undefined || agent === undefined) {
        sendJson(res, 404, { ok: false, error: 'session not found' })
        return
      }
      // 用插件挂载时的真实配置（用户可覆盖阈值/检查项），不是默认值。
      const report = await assess(ctx, session, agent.id, controller.signal, config)
      sendJson(res, 200, { ok: true, result: { text: buildHandoffSummary(report) } })
      return
    }
    sendJson(res, 400, { ok: false, error: `unknown method: ${String(call.method)}` })
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
  } finally {
    clearTimeout(timeout)
  }
}
