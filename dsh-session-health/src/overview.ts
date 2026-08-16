/**
 * dsh-session-health — multi-session overview (panel data).
 *
 * Host side of the 多会话健康一览面板: one read-only snapshot of every
 * session's health verdict for the browser panel (`sidebar.footer.action`
 * opens it, `shell.overlay` renders it).
 *
 * Data path: `sessionQuery.listSessions()` → per-record health value
 * (live sessions cut the projection registry's O(1) snapshot; cold sessions
 * read the persisted projection cache, falling back to an async cold load)
 * and titles (live sessions cut the log-backed title fold; the rest are
 * batch-read). Everything is read-only — the panel never mutates sessions,
 * projections, or caches.
 *
 * Transport: same-origin JSON RPC (POST /session-health-rpc, loopback-only),
 * the same pattern dsh-imgdraw established for bundle clients — a bundle
 * client cannot expose a plugin Remote, so browser↔host calls ride the
 * webServer route seam.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HealthSeverity, SessionHealthProjection } from './types.ts'

/** One session row in the overview panel. */
export interface OverviewRow {
  id: string
  /** Best-known title; null when no title event exists yet. */
  title: string | null
  /** True when the session is currently materialized in ctx.sessions. */
  live: boolean
  /** Session creation time (Unix epoch ms) — secondary sort key. */
  createdAt: number
  /** The health verdict; null when no projection value exists (cold + no cache row). */
  health: SessionHealthProjection | null
  /** Session working directory (diagnostics / workspace display). */
  cwd: string | null
  /** Subagent-child marker from the session header (diagnostics). */
  origin: string | null
}

const SEVERITY_RANK: Record<HealthSeverity, number> = { red: 0, yellow: 1, blue: 2, green: 3 }

/** Sort rank: red first, then yellow / blue / green, unknown last. */
export function rankOf(health: SessionHealthProjection | null | undefined): number {
  if (health === undefined || health === null) return 4
  return SEVERITY_RANK[health.severity] ?? 4
}

/** Stable sort: severity tier first (red on top), newest session first inside a tier. */
export function sortOverviewRows(rows: OverviewRow[]): OverviewRow[] {
  return [...rows].sort((a, b) => {
    const ra = rankOf(a.health)
    const rb = rankOf(b.health)
    if (ra !== rb) return ra - rb
    return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })
}

/** Loose face of the sessionQuery service (only the parts overview needs). */
interface SessionQueryLike {
  listSessions(signal?: AbortSignal): Promise<Array<{
    header: { id: string; createdAt?: number; cwd?: string; origin?: string }
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
  get(id: string): { header?: { id?: string; cwd?: string } } | undefined
}

/**
 * Current workspace root for the panel's session scope. The sidebar shows one
 * workspace's sessions at a time, so the overview must match: sandboxPolicy's
 * workspaceRoot when configured, else the cwd of the newest live session.
 * Returns null when neither is available — the caller then skips the cwd
 * filter rather than showing an empty panel.
 */
function resolveWorkspaceRoot(ctx: Context, sessionsStore: SessionsStoreLike | undefined): string | null {
  try {
    const sp = ctx.get('sandboxPolicy') as { workspaceRoot?: string } | undefined
    if (sp?.workspaceRoot !== undefined && sp.workspaceRoot !== null && sp.workspaceRoot !== '') {
      return sp.workspaceRoot
    }
  } catch { /* fall through */ }
  if (sessionsStore === undefined) return null
  try {
    // Newest live session's cwd as a fallback workspace anchor.
    const live = (ctx.get('sessions') as { list?(): Array<{ header?: { cwd?: string; id?: string } }> } | undefined)?.list?.()
    let newest: { header?: { cwd?: string; id?: string } } | undefined
    for (const s of live ?? []) {
      if (s.header?.cwd && (newest === undefined || (s.header.id ?? '') > (newest.header?.id ?? ''))) newest = s
    }
    return newest?.header?.cwd ?? null
  } catch {
    return null
  }
}

/**
 * Build the overview rows for the current workspace's top-level sessions.
 * Never throws on a single bad session — per-record failures degrade to
 * `health: null` / `title: null` so one broken record cannot blank the whole
 * panel. Returns [] when the sessionQuery service is absent (headless
 * assemblies keep working).
 */
export async function buildOverview(ctx: Context, signal: AbortSignal): Promise<OverviewRow[]> {
  const sessionQuery = ctx.get('sessionQuery') as SessionQueryLike | undefined
  if (sessionQuery === undefined) return []

  let records: Array<{ header: { id: string; createdAt?: number; cwd?: string; origin?: string }; live?: boolean; persisted?: boolean }>
  try {
    records = await sessionQuery.listSessions(signal)
  } catch {
    return []
  }
  if (!Array.isArray(records) || records.length === 0) return []

  const sessionsStore = ctx.get('sessions') as SessionsStoreLike | undefined
  const workspaceRoot = resolveWorkspaceRoot(ctx, sessionsStore)
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

  const rows: OverviewRow[] = []
  const pendingTitles: string[] = []

  for (const rec of records) {
    const id = rec.header?.id
    if (typeof id !== 'string' || id === '') continue
    // The sidebar lists top-level sessions of the current workspace only:
    // subagent children and sessions from other workspaces stay out.
    if (rec.header.origin === 'subagent') continue
    if (workspaceRoot !== null) {
      const cwd = rec.header.cwd
      const inWorkspace = typeof cwd === 'string' && cwd.length > 0
        && (cwd === workspaceRoot || cwd.startsWith(`${workspaceRoot}/`))
      if (!inWorkspace) continue
    }
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
      try {
        const snap = await cache.coldSnapshot(id, signal)
        const value = snap?.values?.sessionHealth as SessionHealthProjection | undefined
        if (value !== undefined && value !== null) health = value
      } catch { /* keep null */ }
    }

    // Title: live log-backed fold first, batch query for the rest.
    let title: string | null = null
    if (liveSession !== undefined && titleSvc !== undefined) {
      try { title = titleSvc.get(liveSession)?.title ?? null } catch { /* batch below */ }
    }
    if (title === null) pendingTitles.push(id)

    rows.push({
      id,
      title,
      live: rec.live === true,
      createdAt,
      health,
      cwd: typeof rec.header.cwd === 'string' ? rec.header.cwd : null,
      origin: typeof rec.header.origin === 'string' ? rec.header.origin : null,
    })
  }

  // Batch title observation for sessions without a live fold (cold sessions).
  if (pendingTitles.length > 0 && sessionQuery.readTitleSnapshots !== undefined) {
    try {
      const observations = await sessionQuery.readTitleSnapshots(pendingTitles, signal)
      const byId = new Map(rows.map(r => [r.id, r]))
      for (const o of observations) {
        if (o.status !== 'fulfilled') continue
        const row = byId.get(o.sessionId)
        if (row !== undefined && o.value?.title?.title) row.title = o.value.title.title
      }
    } catch { /* titles stay null */ }
  }

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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/** RPC request shape from the browser panel. */
interface RpcCall {
  method?: string
}

/**
 * Full HTTP handler for POST /session-health-rpc. Methods:
 *   { method: 'overview' } → { ok: true, result: { sessions: OverviewRow[] } }
 * Loopback-only (panel data is private to the machine); 405 on non-POST,
 * 400 on malformed JSON, 403 on non-loopback peers, 500 on service failure.
 */
export async function handleOverviewRpc(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: Context,
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
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid json' })
    return
  }
  if (call.method !== 'overview') {
    sendJson(res, 400, { ok: false, error: `unknown method: ${String(call.method)}` })
    return
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const sessions = await buildOverview(ctx, controller.signal)
    sendJson(res, 200, { ok: true, result: { sessions } })
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) })
  } finally {
    clearTimeout(timeout)
  }
}
