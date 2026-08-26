/** dsh-context-compass — multi-session overview panel (sidebar action + overlay) (extracted). */
import * as React from 'react'
import type { SessionHealthProjection, HealthSeverity } from '../types.ts'
import { formatCny, formatUsd } from '../util.ts'
import { compact, SEVERITY_LABEL, SEVERITY_ARIA, type CommandsRemote } from './shared.ts'

/**
 * Multi-session overview panel — the 上下文罗盘一览 roadmap item.
 *
 * Two seats share one tiny open-state store (created per apply, disposed with
 * the fiber): `sidebar.footer.action` opens the panel, `shell.overlay`
 * renders it while open and null otherwise (the overlay pattern: "each reads
 * its own store and renders null while closed"). Data rides the same-origin
 * host RPC route `/context-compass-rpc` (bundle clients cannot mount a plugin
 * Remote — the imgdraw seam), fetched on open and refreshed while open.
 * Rows are host-sorted red → yellow → blue → green → unknown; clicking a row
 * opens that session and runs /compass for it.
 */

/** Refresh cadence of the open panel (ms). */
const PANEL_REFRESH_MS = 5000

/** Minimal row shape from the host overview RPC. */
export interface OverviewRowLike {
  id: string
  title: string | null
  /** 真实活动三态：运行中（智能体回回合）/ 已加载（内存驻留待命）/ 冷却（仅持久化）。 */
  status: 'running' | 'loaded' | 'cold'
  createdAt: number
  health: SessionHealthProjection | null
  workspace: { id: string; title: string } | null
}

/** External open-state store shared by the footer action and the overlay. */
export class OverviewStore {
  private open = false
  private readonly listeners = new Set<() => void>()
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getOpen = (): boolean => this.open
  setOpen(open: boolean): void {
    if (this.open === open) return
    this.open = open
    for (const listener of [...this.listeners]) listener()
  }
}

const SEVERITY_RANK: Record<HealthSeverity, number> = { red: 0, yellow: 1, blue: 2, green: 3 }

/** Relative creation time — repeated titles stay distinguishable in the list. */
function ageOf(ts: number): string {
  if (ts <= 0) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}


/**
 * 相对时间（上次使用）：与侧边栏行尾同风格的紧凑桶（刚刚 / N分前 / N时前 /
 * N天前 / N月前）。`now` 由调用方传入，便于轮询帧统一刷新。
 */
function agoShort(updatedAt: number | undefined, now: number): string {
  if (updatedAt === undefined || !(updatedAt > 0)) return '—'
  const s = Math.max(0, Math.floor((now - updatedAt) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}月前`
  return `${Math.floor(mo / 12)}年前`
}

/** Full date for hover titles: YYYY-MM-DD. */
function dateFull(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Sort modes: 'severity' = 方案 A (tier → activity → newest), 'time' = newest first. */
export type SortMode = 'severity' | 'time'

/** Activity sort rank: running first, then loaded, then cold. */
function activityRankOf(status: OverviewRowLike['status'] | undefined): number {
  return status === 'running' ? 0 : status === 'loaded' ? 1 : 2
}

/** 状态列的三态文案/样式/说明（运行中=智能体回合中；已加载=待命；冷却=仅持久化）。 */
const ACTIVITY_LABEL: Record<OverviewRowLike['status'], { label: string; cls: string; tip: string; meta: string }> = {
  running: { label: '运行中', cls: 'sh-row-running', tip: '智能体正在处理回回合（进行中）', meta: '运行中（智能体在工作）' },
  loaded: { label: '已加载', cls: 'sh-row-loaded', tip: '内存驻留待命（空闲）', meta: '已加载（内存驻留·空闲）' },
  cold: { label: '冷却', cls: 'sh-row-cold', tip: '仅持久化（未加载）', meta: '冷会话（仅持久化）' },
}

/** 每轮金额（含缓存折扣），zh 显示 CNY 否则 USD；null 表示暂无计费数据。 */
function moneyOf(proj: SessionHealthProjection | null, isZh: boolean): string | null {
  if (proj === null) return null
  const cny = proj.effectivePerRoundCny
  const usd = proj.effectivePerRoundUsd
  if (isZh && cny !== null && cny !== undefined) return formatCny(cny)
  if (usd !== null && usd !== undefined) return formatUsd(usd)
  return null
}

/** Rows arrive host-sorted (severity mode); the client re-sorts locally for
    the selected mode and refreshes. */
function sortRows(
  rows: OverviewRowLike[],
  mode: SortMode,
  updatedById: Record<string, { updatedAt?: number }> = {},
): OverviewRowLike[] {
  const updated = (r: OverviewRowLike): number => updatedById[r.id]?.updatedAt ?? r.createdAt ?? 0
  return [...rows].sort((a, b) => {
    if (mode === 'time') return updated(b) - updated(a)
    // 运行中永远置顶（跨 severity tier，与 host sortOverviewRows 同规则），
    // 且运行中组内也按 红→黄→蓝→绿 排——正在跑的黄比正在跑的绿更急。
    const arn = a.status === 'running', brn = b.status === 'running'
    if (arn !== brn) return arn ? -1 : 1
    const ra = a.health === null ? 4 : SEVERITY_RANK[a.health.severity] ?? 4
    const rb = b.health === null ? 4 : SEVERITY_RANK[b.health.severity] ?? 4
    if (ra !== rb) return ra - rb
    const aa = activityRankOf(a.status)
    const ab = activityRankOf(b.status)
    if (aa !== ab) return aa - ab
    return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })
}

/** Panel page size (agreed: 5 rows per page — the usual live-session count). */
const PAGE_SIZE = 5

/** Sidebar-foot action: opens the overview panel (wide row vs 56px rail). */
export function OverviewAction(props: {
  wide: boolean
  store: OverviewStore
}): JSX.Element {
  return (
    <button
      type="button"
      className={`sh-fa${props.wide ? '' : ' sh-fa-rail'}`}
      onClick={() => props.store.setOpen(true)}
      aria-label="上下文罗盘一览（打开所有会话的上下文面板）"
      title="上下文罗盘一览"
    >
      <span className="sh-fa-dot" />
      {props.wide ? <span>罗盘一览</span> : null}
    </button>
  )
}

/** Full-screen overview panel; renders null while closed. */
export function OverviewPanel(props: {
  store: OverviewStore
  sessions: { open(id: string): void; list: { getSnapshot(): { byId: Record<string, { updatedAt?: number }> } } }
  commands: CommandsRemote
  locale: { snapshot: { active: string } }
}): JSX.Element | null {
  const open = React.useSyncExternalStore(props.store.subscribe, props.store.getOpen)
  if (!open) return null
  return <OverviewBody {...props} />
}

export function OverviewBody(props: {
  store: OverviewStore
  sessions: { open(id: string): void; list: { getSnapshot(): { byId: Record<string, { updatedAt?: number }> } } }
  commands: CommandsRemote
  locale: { snapshot: { active: string } }
}): JSX.Element {
  const [rows, setRows] = React.useState<OverviewRowLike[] | null>(null)
  const [sortMode, setSortMode] = React.useState<SortMode>(() => {
    try { return window.localStorage.getItem('dsh-context-compass/overviewSort') === 'time' ? 'time' : 'severity' } catch { return 'severity' }
  })
  const [page, setPage] = React.useState(0)
  // Hover tooltip: VIEWPORT coords (fixed positioning — the tooltip never
  // participates in the list's scroll geometry, so no clipping and no
  // scrollbar flash) + the owning row id (every row used to render its own).
  const [tip, setTip] = React.useState<{ rowId: string; cx: number; cy: number } | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const closeRef = React.useRef<HTMLButtonElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  // The refresh interval's load() closure must see the current sort mode.
  const sortModeRef = React.useRef<SortMode>(sortMode)
  sortModeRef.current = sortMode
  // 上次使用时间（sessions store 的 byId）：同步读 + ref，供 load()/changeSort
  // 闭包与渲染共同使用；store 未就绪时为空表（全部显示 —）。
  const updatedByIdRef = React.useRef<Record<string, { updatedAt?: number }>>({})
  try { updatedByIdRef.current = props.sessions.list.getSnapshot().byId ?? {} } catch { /* store 未就绪 */ }

  // Fetch on mount + refresh while open; component unmounts when closed, so
  // the effect cleans up with it (no leak across panel sessions). The current
  // session id (fed by the badge) anchors the workspace scope host-side.
  React.useEffect(() => {
    let alive = true
    let timer: number | null = null
    const load = async () => {
      try {
        const res = await fetch('/context-compass-rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'overview' }),
        })
        const json = (await res.json()) as { ok?: boolean; error?: string; result?: { sessions?: OverviewRowLike[] } }
        if (!alive) return
        if (json.ok === true && Array.isArray(json.result?.sessions)) {
          const next = sortRows(json.result.sessions, sortModeRef.current, updatedByIdRef.current)
          // Refresh keeps the current page (a 5s poll must not kick the user
          // back to page one); clamp when sessions shrank below the page.
          const pages = Math.max(1, Math.ceil(next.length / PAGE_SIZE))
          setPage(p => Math.min(p, pages - 1))
          setRows(next)
          setLoadError(null)
        } else {
          setLoadError(json.error ?? '未知错误')
        }
      } catch {
        if (alive) setLoadError('无法连接 /context-compass-rpc')
      }
    }
    void load()
    timer = window.setInterval(() => { void load() }, PANEL_REFRESH_MS)
    return () => {
      alive = false
      if (timer !== null) window.clearInterval(timer)
    }
  }, [props.store])

  // Esc closes; focus moves into the panel on open. The page behind the
  // overlay must not scroll (wheel passes through the scrim otherwise).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.store.setOpen(false)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [props.store])

  const close = () => props.store.setOpen(false)
  const isZh = (props.locale?.snapshot?.active ?? 'zh') === 'zh'
  const openSession = (id: string) => {
    try { props.sessions.open(id) } catch { /* 静默 */ }
    // 冷会话：sessions.open 是异步加载（agent 初始化），立即 execute 会在
    // UI request 的 signal 被 abort（面板 close/组件卸载）时让 assess 中途
    // 挂掉 → 「执行失败 This operation was aborted」。给加载一点时间再发。
    window.setTimeout(() => {
      try { void props.commands.execute(id, '/compass') } catch { /* 静默 */ }
    }, 600)
    close()
  }
  const redCount = rows === null ? 0 : rows.filter(r => r.health?.severity === 'red').length
  const yellowCount = rows === null ? 0 : rows.filter(r => r.health?.severity === 'yellow').length
  const pageCount = rows === null ? 0 : Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows = rows === null ? null : rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const changeSort = (mode: SortMode) => {
    setSortMode(mode)
    try { window.localStorage.setItem('dsh-context-compass/overviewSort', mode) } catch { /* 静默 */ }
    if (rows !== null) setRows(sortRows(rows, mode, updatedByIdRef.current))
    setPage(0)
    listRef.current?.scrollTo({ top: 0 })
  }
  const gotoPage = (next: number) => {
    setPage(next)
    listRef.current?.scrollTo({ top: 0 })
  }
  const sub = rows === null
    ? '加载中…'
    : `${rows.length} 个会话${redCount > 0 ? ` · 红 ${redCount}` : ''}${yellowCount > 0 ? ` · 黄 ${yellowCount}` : ''}`
  // 上次使用时间：sessions store 的 byId 行（与侧边栏同源），每次渲染同步读——
  // 5s 轮询帧自然刷新相对时间。store 缺行（冷会话未入列表）时显示 —。
  const nowMs = Date.now()
  const updatedById = updatedByIdRef.current

  return (
    <div className="sh-scrim" onClick={close}>
      <div
        className="sh-panel"
        role="dialog"
        aria-modal="true"
        aria-label="上下文罗盘一览"
        onClick={e => e.stopPropagation()}
      >
        <div className="sh-panel-head">
          <span className="sh-panel-title">上下文罗盘一览</span>
          <span className="sh-panel-sub">{sub}</span>
          <button
            type="button"
            ref={closeRef}
            className="sh-panel-close"
            aria-label="关闭上下文罗盘一览"
            onClick={close}
          >
            ×
          </button>
        </div>
        <div className="sh-panel-head-row sh-grid-cols" role="row">
          <button type="button" className={`sh-col-head${sortMode === 'severity' ? ' sh-sort-active' : ''}`} onClick={() => changeSort('severity')} aria-label="按健康状态排序">健康{sortMode === 'severity' ? '↓' : ''}</button>
          <span title="运行中=智能体正在处理回回合；已加载=内存驻留待命；冷却=仅持久化">状态</span>
          <span className="sh-row-num" title="上下文占用（窗口百分比）">占用</span>
          <span className="sh-row-num sh-dim" title="每轮输入计费当量（含缓存折扣）">输入</span>
          <span className="sh-row-num sh-dim" title="每轮输入费用（含缓存折扣，忙闲时价）">费用</span>
          <span className="sh-row-num" title="轮次 / 消息数">规模</span>
          <button type="button" className={`sh-col-head sh-row-num${sortMode === 'time' ? ' sh-sort-active' : ''}`} onClick={() => changeSort('time')} aria-label="按上次使用排序">活动{sortMode === 'time' ? '↓' : ''}</button>
        </div>
        <div className="sh-panel-list" ref={listRef}>
          {rows === null && loadError === null ? (
            <div className="sh-panel-empty">正在读取各上下文罗盘数据…</div>
          ) : rows === null ? (
            <div className="sh-panel-empty">加载失败：{loadError}</div>
          ) : rows.length === 0 ? (
            <div className="sh-panel-empty">没有可显示的会话</div>
          ) : (
            (pageRows ?? []).map(row => {
              const health = row.health
              const severity: HealthSeverity | 'unknown' = health?.severity ?? 'unknown'
              const pct = health?.ratio !== null && health?.ratio !== undefined
                ? Math.min(Math.round(health.ratio * 100), 100)
                : null
              const metaBits = [
                row.createdAt > 0 ? `创建于 ${ageOf(row.createdAt)}` : null,
                pct !== null ? `占用 ${pct}%` : '占用未知',
                health?.effectivePerRound !== null && health?.effectivePerRound !== undefined
                  ? `约 ${compact(health.effectivePerRound)} token/轮`
                  : null,
                health !== null ? `${health.turns} 轮 / ${health.userMessages + health.assistantMessages} 条` : null,
                health !== null && health.compactions > 0
                  ? `已压缩 ${health.compactions} 次${health.compressionRatio !== null && health.compressionRatio !== undefined ? `（上次压缩比例 ≈ ${Math.round(health.compressionRatio * 100)}%，快照口径）` : ''}`
                  : null,
                ACTIVITY_LABEL[row.status]?.meta ?? '冷会话',
              ].filter((v): v is string => v !== null)
              const ariaSev = severity === 'unknown' ? '未知' : SEVERITY_ARIA[severity]
              const wsLabel = row.workspace !== null ? row.workspace.title : '未分组'
              const scale = health !== null ? `${health.turns}轮/${health.userMessages + health.assistantMessages}条` : '—'
              const perRound = health?.effectivePerRound !== null && health?.effectivePerRound !== undefined
                ? compact(health.effectivePerRound)
                : '—'
              const occ = pct !== null ? `${pct}%` : '—'
              const cost = moneyOf(health, isZh)
              const titleText = `${row.title ?? '未命名会话'}[${wsLabel}]`
              const moveTip = (e: React.MouseEvent) => {
                setTip({ rowId: row.id, cx: e.clientX, cy: e.clientY })
              }
              // Flip below the pointer near the viewport top (header zone);
              // clamp horizontally so the label never leaves the screen.
              const tipBelow = tip !== null && tip.cy < 96
              const tipLeft = tip !== null ? Math.min(Math.max(tip.cx, 100), window.innerWidth - 100) : 0
              const tipTop = tip !== null ? (tipBelow ? tip.cy + 14 : tip.cy - 8) : 0
              return (
                <button
                  type="button"
                  key={row.id}
                  className={`sh-panel-row sh-grid-cols${severity !== 'unknown' ? ` sh-sev-${severity}` : ''}`}
                  onClick={() => openSession(row.id)}
                  onMouseEnter={moveTip}
                  onMouseMove={moveTip}
                  onMouseLeave={() => setTip(null)}
                  aria-label={`上下文罗盘：${ariaSev}。${titleText}。${metaBits.join('，')}。点击打开并运行 /compass`}
                >
                  {tip !== null && tip.rowId === row.id ? (
                    <span className={`sh-rowtip${tipBelow ? ' sh-rowtip-below' : ''}`} role="tooltip" style={{ left: tipLeft, top: tipTop }}>{titleText}</span>
                  ) : null}
                  <span className="sh-sev-chip"><span className="sh-row-dot" />{severity === 'unknown' ? '暂无数据' : SEVERITY_LABEL[severity]}</span>
                  <span className={`sh-row-${row.status ?? 'cold'}`} title={ACTIVITY_LABEL[row.status]?.tip ?? '仅持久化（未加载）'}>{ACTIVITY_LABEL[row.status]?.label ?? '冷却'}</span>
                  <span className="sh-row-num" title={pct !== null ? `上下文占用 ${pct}%` : undefined}>{occ}</span>
                  <span className="sh-row-num sh-dim" title={perRound !== '—' ? `每轮输入约 ${perRound} token（计费当量，含缓存折扣）` : undefined}>{perRound}</span>
                  <span className="sh-row-num sh-dim" title={cost !== null ? `每轮约 ${cost}（含缓存折扣，忙闲时价）` : undefined}>{cost ?? '—'}</span>
                  <span className="sh-row-num">{scale}</span>
                  <span className="sh-row-num sh-dim" title={updatedById[row.id]?.updatedAt !== undefined
                    ? `上次使用 ${dateFull(updatedById[row.id]!.updatedAt!)}；创建于 ${row.createdAt > 0 ? dateFull(row.createdAt) : '—'}`
                    : row.createdAt > 0 ? `创建于 ${dateFull(row.createdAt)}` : undefined}>{agoShort(updatedById[row.id]?.updatedAt, nowMs)}</span>
                </button>
              )
            })
          )}
        </div>
        <div className="sh-panel-foot">
          {rows !== null && rows.length > PAGE_SIZE ? (
            <span className="sh-pager">
              <button type="button" className="sh-pager-btn" disabled={page <= 0} onClick={() => gotoPage(page - 1)} aria-label="上一页">‹</button>
              <span className="sh-pager-info">{page + 1} / {pageCount}</span>
              <button type="button" className="sh-pager-btn" disabled={page >= pageCount - 1} onClick={() => gotoPage(page + 1)} aria-label="下一页">›</button>
            </span>
          ) : null}
          <span className="sh-foot-hint">每 5 秒刷新 · 点击行打开并运行 /compass · 点表头切换排序 · Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
