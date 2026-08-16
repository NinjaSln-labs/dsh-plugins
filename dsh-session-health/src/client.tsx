/**
 * dsh-session-health — Client half.
 *
 * Renders a session-health badge in `conversation.session.header.utilities`
 * (right side of the session header, next to the Session log button), styled
 * with DSH theme tokens and sized identically to the adjacent button.
 *
 * Data flow: PURE projection push. The badge subscribes to the host-computed
 * `sessionHealth` projection (`sessions.binding(...).session.projections
 * .faceOf('sessionHealth')`), updated by `session/projection` frames the
 * moment the host fold changes — zero polling, zero RPC. The projection seam
 * is the one wire path community plugins own: the browser mounts a fixed,
 * build-time generated Remote list (api-remotes), so a plugin Remote such as
 * `remote.sessionHealth` can never mount — inject it and the entry stays
 * pending forever (web boot: waiting for service: remote.sessionHealth).
 *
 * Clicking the badge runs `/health` through the core commands Remote
 * (`remote.commands`, always mounted) for the full textual report.
 */
import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the header.utilities seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the two seats below live in OTHER ui packages (ui-sidebar
// declares sidebar.footer.action, ui-layout declares shell.overlay) that are
// not on this plugin's type resolution path. The runtime slot tree was
// verified via the harness Inspect provider; this local augmentation mirrors
// the owner-prop contracts from those packages' d.ts files (compile-time only
// — erased from the bundle; slots.inject on a runtime-missing key is inert).
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Owner share of one action beside Settings at the sidebar foot. */
    'sidebar.footer.action': {
      kind: 'list'
      scope: 'root'
      owner: { wide: boolean }
    }
    /** Frame-wide floating layer (list slot, no owner props). */
    'shell.overlay': {
      kind: 'list'
      scope: 'root'
    }
  }
}
import type { SessionHealthProjection, HealthSeverity } from './types.ts'
import { cacheHitRateOf, type TokenUsageLike } from './usage.ts'

const CSS = `
.sh-wrap{position:relative;display:inline-flex}
.sh-badge{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:6px 12px;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-color:var(--sh-accent,var(--dsw-alias-border-l2));border-radius:18px;color:var(--dsw-alias-label-secondary);background:transparent;font-size:13px;font-weight:400;line-height:20px;box-sizing:border-box;cursor:pointer;user-select:none;white-space:nowrap}
.sh-badge:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-badge:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:2px}
.sh-badge .sh-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--sh-accent,var(--dsw-alias-label-secondary))}
/* Severity palette — three theme-adaptive roles per tier:
   --sh-accent (dot/border/bar), --sh-ink (severity text), --sh-tint (chip bg).
   Light themes deepen the hues for contrast on pale surfaces; dark themes
   lighten them for contrast on the dark overlay. All text ratios >= 3:1 in
   both themes (WCAG AA for graphical objects / emphasis); hue separation
   between the four tiers is kept wide in both themes. */
.sh-sev-green{--sh-accent:color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,black);--sh-ink:color-mix(in srgb,var(--dsw-alias-state-success-primary) 42%,black);--sh-tint:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent)}
.sh-sev-blue{--sh-accent:var(--dsw-static-blue-600);--sh-ink:var(--dsw-static-blue-600);--sh-tint:color-mix(in srgb,var(--dsw-static-blue-500) 13%,transparent)}
.sh-sev-yellow{--sh-accent:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,black);--sh-ink:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 42%,black);--sh-tint:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
.sh-sev-red{--sh-accent:var(--dsw-alias-state-error-primary);--sh-ink:var(--dsw-alias-state-error-primary);--sh-tint:color-mix(in srgb,var(--dsw-alias-state-error-primary) 13%,transparent)}
body[data-ds-dark-theme] .sh-sev-green{--sh-accent:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,white);--sh-ink:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,white)}
body[data-ds-dark-theme] .sh-sev-blue{--sh-accent:color-mix(in srgb,var(--dsw-static-blue-500) 50%,white);--sh-ink:color-mix(in srgb,var(--dsw-static-blue-500) 55%,white)}
body[data-ds-dark-theme] .sh-sev-yellow{--sh-accent:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,white);--sh-ink:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,white)}
body[data-ds-dark-theme] .sh-sev-red{--sh-accent:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,white);--sh-ink:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,white)}
.sh-tip{position:absolute;top:calc(100% + 8px);right:0;min-width:280px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.22);z-index:50;text-align:left}
.sh-tip-title{font-size:13px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.sh-tip-title .sh-sev-label{color:var(--sh-ink,var(--dsw-alias-label-secondary));font-weight:600}
.sh-tip-advice{font-size:13px;line-height:1.6;padding:8px 10px;border-radius:8px;font-weight:600;color:var(--sh-ink,var(--dsw-alias-label-primary));background:var(--sh-tint,transparent);margin-bottom:8px}
.sh-tip-row{display:flex;align-items:center;gap:10px;line-height:2}
.sh-tip-row .sh-k{color:var(--dsw-alias-label-secondary);flex:none}
.sh-tip-row .sh-v{color:var(--dsw-alias-label-secondary);margin-left:auto;font-variant-numeric:tabular-nums}
.sh-cost-toggle{cursor:pointer;border-radius:4px}
.sh-cost-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-cost-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
.sh-bar{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;max-width:110px}
.sh-bar-fill{height:100%;border-radius:3px;display:block;background:var(--sh-accent,var(--dsw-alias-label-secondary))}
.sh-tip-hint{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px}
/* Invisible bridge over the badge↔tooltip gap: the mouse path into the
   tooltip never leaves the wrapper, so the popover stays clickable. */
.sh-tip::before{content:'';position:absolute;top:-8px;left:0;right:0;height:8px}
.sh-tip{animation:sh-tip-in .15s ease-out}
@keyframes sh-tip-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.sh-tip{animation:none}}
/* Sidebar footer action (multi-session overview opener): styled and sized
   like the New Session button (38px, radius 12, elevated fill + border),
   entirely on theme tokens so it follows light/dark themes with the shell.
   Rail state mirrors the New Session rail icon (36px, borderless, hover
   tint). The severity palette classes above are reused for the dot. */
.sh-fa{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:8px 16px;margin:0 2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;flex:none;cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden}
.sh-fa:hover{background:var(--dsw-alias-button-floating-hover)}
.sh-fa:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:2px}
.sh-fa .sh-fa-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}
.sh-fa-rail{width:36px;height:36px;padding:0;margin:0 0 12px;align-self:flex-start;border-color:transparent;background:transparent}
.sh-fa-rail:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Overview panel: frame-wide scrim + centered card. The shell.overlay layer
   is click-through by default — the panel opts back into pointer events. */
.sh-scrim{position:fixed;inset:0;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent);display:flex;align-items:center;justify-content:center;padding:32px;pointer-events:auto;z-index:60;animation:sh-fade-in .15s ease-out}
@keyframes sh-fade-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.sh-scrim{animation:none}}
.sh-panel{width:min(760px,100%);max-height:min(76vh,720px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.3);overflow:hidden}
.sh-panel-head{display:flex;align-items:baseline;gap:10px;padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.sh-panel-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.sh-panel-sub{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sh-panel-close{flex:none;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;line-height:1;cursor:pointer}
.sh-panel-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-panel-close:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
.sh-panel-legend{display:flex;flex-wrap:wrap;gap:4px 14px;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-tertiary)}
.sh-panel-legend .sh-legend-item{display:inline-flex;align-items:center;gap:5px}
.sh-panel-legend .sh-legend-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--sh-accent,var(--dsw-alias-label-tertiary))}
.sh-panel-list{overflow-y:auto;padding:8px;flex:1}
.sh-panel-row{display:flex;align-items:center;gap:10px;width:100%;padding:9px 12px;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;box-sizing:border-box}
.sh-panel-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-panel-row:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
.sh-panel-row .sh-row-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--sh-accent,var(--dsw-alias-label-tertiary))}
.sh-panel-row .sh-row-main{flex:1;min-width:0}
.sh-panel-row .sh-row-title{font-size:13px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sh-panel-row .sh-row-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:1px;font-variant-numeric:tabular-nums}
.sh-panel-row .sh-row-sev{flex:none;font-size:12px;color:var(--sh-ink,var(--dsw-alias-label-secondary));font-weight:600}
.sh-panel-row .sh-row-right{flex:none;text-align:right;font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.sh-panel-empty{padding:28px 16px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.sh-panel-foot{padding:8px 16px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-tertiary)}
`

function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '未知'
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + 'M'
  }
  if (n >= 1000) return Math.round(n / 1000) + 'K'
  return String(n)
}

/** Hit rate display: integer percent, Math.round — matches the core input-bar stats line (same figure, same rounding). */
function pctOf(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

/** USD formatting for per-round cost: >= $100 rounded, else 2 decimals ($0.02, $1.25, $45). */
function formatUsd(v: number): string {
  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`
}

/** Visible tooltip label — the tier's color is already shown by the chip, so no color word. */
const SEVERITY_LABEL: Record<HealthSeverity, string> = {
  green: '放心继续',
  blue: '继续，留意',
  yellow: '建议留意',
  red: '建议收尾',
}

/** aria-label variant keeps the color word: screen readers cannot see the chip color. */
const SEVERITY_ARIA: Record<HealthSeverity, string> = {
  green: '绿：放心继续',
  blue: '蓝：继续，留意',
  yellow: '黄：建议留意',
  red: '红：建议收尾',
}

/** Projection face shape from the runtime client. */
interface ProjectionFace {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

/**
 * token-meter's contextPressure projection value (the harness core publishes
 * it alongside sessionHealth; compaction-aware).
 */
export interface ContextPressureLike {
  /** Provider-reported prompt size of the most recent request. */
  pressureTokens?: number
  /** What the NEXT request's prompt would cost (reacts to compaction). */
  projectedTokens?: number
  /** Newest known route capacity. */
  contextWindow?: number
}

/**
 * Merge the sessionHealth verdict with token-meter's compaction-aware
 * contextPressure numbers: the occupancy figure the badge displays should be
 * "what the next request costs", not a stale pre-compaction sample. Pure.
 */
export function mergePressure(
  proj: SessionHealthProjection | undefined,
  pressure: ContextPressureLike | undefined,
): { total: number | null; window: number | null; ratio: number | null; projected: number | null } {
  const total = proj?.total ?? pressure?.pressureTokens ?? pressure?.projectedTokens ?? null
  const window = proj?.window ?? pressure?.contextWindow ?? null
  const ratio = total !== null && window !== null && window > 0 ? total / window : null
  const projected = pressure?.projectedTokens ?? null
  return { total, window, ratio, projected }
}

/** Commands Remote face (core, always mounted). */
interface CommandsRemote {
  execute(sessionId: string, line: string): Promise<unknown>
}

function HealthBadge(props: {
  sessionId: string
  commands: CommandsRemote
  sessions: {
    binding(sessionId: string): { session: { projections: { faceOf(key: string): ProjectionFace | undefined } } } | undefined
  }
  locale: { snapshot: { active: string } }
}): JSX.Element {
  const [proj, setProj] = React.useState<SessionHealthProjection | undefined>(undefined)
  const [pressure, setPressure] = React.useState<ContextPressureLike | undefined>(undefined)
  // Core tokenUsage projection value — same source as the input-bar stats line.
  const [usage, setUsage] = React.useState<TokenUsageLike | undefined>(undefined)
  const [hover, setHover] = React.useState(false)
  // 计费预期行的显示口径：金额（默认）↔ 计费当量 token 数。点击行切换，localStorage 记住。
  const [costAsTokens, setCostAsTokens] = React.useState<boolean>(() => {
    try { return window.localStorage.getItem('dsh-session-health/costDisplay') === 'tokens' } catch { return false }
  })
  // 浮层消失延迟：徽章↔浮层的空隙由 .sh-tip::before 桥接，延迟兜底快速抖动；
  // 键盘聚焦（Tab 进徽章）也打开浮层，blur 移出子树才关闭。
  const hoverTimer = React.useRef<number | null>(null)
  const showTip = () => {
    if (hoverTimer.current !== null) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null }
    setHover(true)
  }
  const hideTip = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHover(false), 250)
  }
  React.useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
  }, [])

  React.useEffect(() => {
    let alive = true
    // Projection push path — frames update the badge the moment the host fold
    // changes. Absence of a value means "no frame yet" (gray state), never a
    // reason to poll: the projection seam is the only client data path.
    const binding = props.sessions.binding?.(props.sessionId)?.session?.projections
    const face = binding?.faceOf?.('sessionHealth')
    const pressureFace = binding?.faceOf?.('contextPressure')
    // Cache-hit rate rides the CORE tokenUsage projection — the exact value
    // the input-bar stats line shows (src/usage.ts has the single formula).
    const usageFace = binding?.faceOf?.('tokenUsage')
    if (face === undefined && pressureFace === undefined && usageFace === undefined) return () => { alive = false }
    const readHealth = () => {
      if (!alive) return
      const v = face?.getSnapshot()
      if (v !== undefined && v !== null) setProj(v as SessionHealthProjection)
    }
    const readPressure = () => {
      if (!alive) return
      const v = pressureFace?.getSnapshot()
      if (v !== undefined && v !== null) setPressure(v as ContextPressureLike)
    }
    const readUsage = () => {
      if (!alive) return
      const v = usageFace?.getSnapshot()
      if (v !== undefined && v !== null) setUsage(v as TokenUsageLike)
    }
    readHealth()
    readPressure()
    readUsage()
    const offs = [
      face !== undefined ? face.subscribe(readHealth) : () => {},
      pressureFace !== undefined ? pressureFace.subscribe(readPressure) : () => {},
      usageFace !== undefined ? usageFace.subscribe(readUsage) : () => {},
    ]
    return () => {
      alive = false
      for (const off of offs) off()
    }
  }, [props.sessionId])

  // The verdict (color/advice) is host-computed and authoritative; the
  // displayed occupancy merges in token-meter's compaction-aware numbers.
  const merged = mergePressure(proj, pressure)
  const severity: HealthSeverity | 'unknown' = proj?.severity ?? 'unknown'
  const pct = merged.ratio !== null ? Math.min(Math.round(merged.ratio * 100), 100) : null

  const runHealth = () => {
    try { void props.commands.execute(props.sessionId, '/health') } catch { /* 静默 */ }
  }
  const toggleCost = () => {
    setCostAsTokens(v => {
      const next = !v
      try { window.localStorage.setItem('dsh-session-health/costDisplay', next ? 'tokens' : 'money') } catch { /* 静默 */ }
      return next
    })
  }
  const onCostKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleCost()
    }
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      runHealth()
    }
  }

  const state = severity === 'unknown' ? 'unknown' : severity
  const text = '会话健康' + (pct !== null ? ` ${pct}%` : '')

  let tip: JSX.Element | null = null
  if (hover) {
    const color = severity === 'unknown' ? null : severity
    const label = severity === 'unknown' ? '未知（等待数据）' : SEVERITY_LABEL[severity]
    const advice = proj?.advice ?? '正在获取会话健康数据…'
    const bar = (
      <span className="sh-bar">
        <span className="sh-bar-fill" style={{ width: `${pct !== null ? Math.min(pct, 100) : 0}%` }} />
      </span>
    )
    tip = (
      <div className={`sh-tip${color !== null ? ` sh-sev-${color}` : ''}`}>
        <div className="sh-tip-title">
          会话健康：
          <span className="sh-sev-label">{label}</span>
        </div>
        <div className="sh-tip-advice">{advice}</div>
        <div className="sh-tip-row">
          <span className="sh-k">上下文占用</span>
          {bar}
          <span className="sh-v">{pct !== null ? `${pct}%` : '未知'}</span>
        </div>
        <div className="sh-tip-row">
          <span className="sh-k">每轮输入</span>
          <span className="sh-v">约 {compact(merged.total)} token{(() => { const rate = cacheHitRateOf(usage); return rate !== null ? `（缓存命中 ${pctOf(rate)}）` : '' })()}</span>
        </div>
        {merged.projected !== null ? (
          <div className="sh-tip-row">
            <span className="sh-k">预计下次输入</span>
            <span className="sh-v">
              {proj?.cacheReadTokens !== null && proj?.cacheReadTokens !== undefined
                ? `约 ${compact(Math.max(0, merged.projected - proj.cacheReadTokens))} token 未命中 / 总量 ${compact(merged.projected)}`
                : `约 ${compact(merged.projected)} token`}
            </span>
          </div>
        ) : null}
        {(() => {
          const isZh = (props.locale?.snapshot?.active ?? 'zh') === 'zh'
          const cny = proj?.effectivePerRoundCny
          const usd = proj?.effectivePerRoundUsd
          const money = isZh && cny !== null && cny !== undefined
            ? `¥${cny.toFixed(2)}`
            : usd !== null && usd !== undefined ? formatUsd(usd) : null
          const effective = proj?.effectivePerRound
          if (money === null && effective === null) return null
          const period = proj?.pricePeriod === 'peak' ? '（忙时价）' : proj?.pricePeriod === 'offpeak' ? '（闲时价）' : ''
          return (
            <div
              className="sh-tip-row sh-cost-toggle"
              role="button"
              tabIndex={0}
              title={costAsTokens ? '点击切换为金额显示' : '点击切换为 token 数量显示'}
              aria-label={costAsTokens ? '计费预期，以 token 数量显示，点击切换为金额' : '计费预期，以金额显示，点击切换为 token 数量'}
              onClick={toggleCost}
              onKeyDown={onCostKeyDown}
            >
              <span className="sh-k">计费预期{costAsTokens ? '（token）' : ''}</span>
              <span className="sh-v">
                {costAsTokens
                  ? effective !== null
                    ? `约 ${compact(effective)} token/轮（计费当量）`
                    : `约 ${money ?? '未知'}/轮（含缓存折扣）${period}`
                  : money !== null
                    ? `约 ${money}/轮（含缓存折扣）${period}`
                    : `约 ${compact(effective ?? 0)} token/轮（计费当量）`}
              </span>
            </div>
          )
        })()}
        <div className="sh-tip-row">
          <span className="sh-k">模型窗口</span>
          <span className="sh-v">{compact(merged.window)}</span>
        </div>
        {proj !== undefined ? (
          <>
            <div className="sh-tip-row">
              <span className="sh-k">会话规模</span>
              <span className="sh-v">{proj.turns} 轮 / {proj.userMessages + proj.assistantMessages} 条消息</span>
            </div>
            {proj.compactions > 0 ? (
              <div className="sh-tip-row">
                <span className="sh-k">已压缩</span>
                <span className="sh-v">{proj.compactions} 次（早期细节概要化）</span>
              </div>
            ) : null}
          </>
        ) : null}
        <div className="sh-tip-hint">点击运行 /health 查看完整报告；点击计费预期切换金额 / token 显示</div>
      </div>
    )
  }

  return (
    <span
      className="sh-wrap"
      onMouseEnter={showTip}
      onMouseLeave={hideTip}
      onFocus={showTip}
      onBlur={(e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hideTip()
      }}
    >
      <span
        className={`sh-badge${state !== 'unknown' ? ` sh-sev-${state}` : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`会话健康：${severity === 'unknown' ? '未知' : SEVERITY_ARIA[severity]}`}
        onClick={runHealth}
        onKeyDown={onKeyDown}
      >
        <span className="sh-dot" />
        <span>{text}</span>
      </span>
      {tip}
    </span>
  )
}

/**
 * Multi-session overview panel — the 多会话健康一览 roadmap item.
 *
 * Two seats share one tiny open-state store (created per apply, disposed with
 * the fiber): `sidebar.footer.action` opens the panel, `shell.overlay`
 * renders it while open and null otherwise (the overlay pattern: "each reads
 * its own store and renders null while closed"). Data rides the same-origin
 * host RPC route `/session-health-rpc` (bundle clients cannot mount a plugin
 * Remote — the imgdraw seam), fetched on open and refreshed while open.
 * Rows are host-sorted red → yellow → blue → green → unknown; clicking a row
 * opens that session and runs /health for it.
 */

/** Refresh cadence of the open panel (ms). */
const PANEL_REFRESH_MS = 5000

/** Minimal row shape from the host overview RPC. */
interface OverviewRowLike {
  id: string
  title: string | null
  live: boolean
  createdAt: number
  health: SessionHealthProjection | null
}

/** External open-state store shared by the footer action and the overlay. */
class OverviewStore {
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

/** Rows arrive host-sorted; defensive client re-sort keeps the panel honest. */
function sortRows(rows: OverviewRowLike[]): OverviewRowLike[] {
  return [...rows].sort((a, b) => {
    const ra = a.health === null ? 4 : SEVERITY_RANK[a.health.severity] ?? 4
    const rb = b.health === null ? 4 : SEVERITY_RANK[b.health.severity] ?? 4
    if (ra !== rb) return ra - rb
    return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })
}

/** Per-round money figure, same currency rule as the badge tooltip. */
function moneyOf(proj: SessionHealthProjection | null, isZh: boolean): string | null {
  if (proj === null) return null
  const cny = proj.effectivePerRoundCny
  const usd = proj.effectivePerRoundUsd
  if (isZh && cny !== null && cny !== undefined) return `¥${cny.toFixed(2)}/轮`
  if (usd !== null && usd !== undefined) return `${formatUsd(usd)}/轮`
  return null
}

/** Sidebar-foot action: opens the overview panel (wide row vs 56px rail). */
function OverviewAction(props: {
  wide: boolean
  store: OverviewStore
}): JSX.Element {
  return (
    <button
      type="button"
      className={`sh-fa${props.wide ? '' : ' sh-fa-rail'}`}
      onClick={() => props.store.setOpen(true)}
      aria-label="会话健康一览（打开所有会话的健康面板）"
      title="会话健康一览"
    >
      <span className="sh-fa-dot" />
      {props.wide ? <span>健康一览</span> : null}
    </button>
  )
}

/** Full-screen overview panel; renders null while closed. */
function OverviewPanel(props: {
  store: OverviewStore
  sessions: { open(id: string): void }
  commands: CommandsRemote
  locale: { snapshot: { active: string } }
}): JSX.Element | null {
  const open = React.useSyncExternalStore(props.store.subscribe, props.store.getOpen)
  if (!open) return null
  return <OverviewBody {...props} />
}

function OverviewBody(props: {
  store: OverviewStore
  sessions: { open(id: string): void }
  commands: CommandsRemote
  locale: { snapshot: { active: string } }
}): JSX.Element {
  const [rows, setRows] = React.useState<OverviewRowLike[] | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const closeRef = React.useRef<HTMLButtonElement | null>(null)

  // Fetch on mount + refresh while open; component unmounts when closed, so
  // the effect cleans up with it (no leak across panel sessions).
  React.useEffect(() => {
    let alive = true
    let timer: number | null = null
    const load = async () => {
      try {
        const res = await fetch('/session-health-rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'overview' }),
        })
        const json = (await res.json()) as { ok?: boolean; error?: string; result?: { sessions?: OverviewRowLike[] } }
        if (!alive) return
        if (json.ok === true && Array.isArray(json.result?.sessions)) {
          setRows(sortRows(json.result.sessions))
          setLoadError(null)
        } else {
          setLoadError(json.error ?? '未知错误')
        }
      } catch {
        if (alive) setLoadError('无法连接 /session-health-rpc')
      }
    }
    void load()
    timer = window.setInterval(() => { void load() }, PANEL_REFRESH_MS)
    return () => {
      alive = false
      if (timer !== null) window.clearInterval(timer)
    }
  }, [])

  // Esc closes; focus moves into the panel on open.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.store.setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [props.store])

  const close = () => props.store.setOpen(false)
  const openSession = (id: string) => {
    try { props.sessions.open(id) } catch { /* 静默 */ }
    try { void props.commands.execute(id, '/health') } catch { /* 静默 */ }
    close()
  }
  const isZh = (props.locale?.snapshot?.active ?? 'zh') === 'zh'
  const redCount = rows === null ? 0 : rows.filter(r => r.health?.severity === 'red').length
  const yellowCount = rows === null ? 0 : rows.filter(r => r.health?.severity === 'yellow').length
  const sub = rows === null
    ? '加载中…'
    : `${rows.length} 个会话${redCount > 0 ? ` · 红 ${redCount}` : ''}${yellowCount > 0 ? ` · 黄 ${yellowCount}` : ''}`

  return (
    <div className="sh-scrim" onClick={close}>
      <div
        className="sh-panel"
        role="dialog"
        aria-modal="true"
        aria-label="会话健康一览"
        onClick={e => e.stopPropagation()}
      >
        <div className="sh-panel-head">
          <span className="sh-panel-title">会话健康一览</span>
          <span className="sh-panel-sub">{sub}</span>
          <button
            type="button"
            ref={closeRef}
            className="sh-panel-close"
            aria-label="关闭会话健康一览"
            onClick={close}
          >
            ×
          </button>
        </div>
        <div className="sh-panel-legend">
          <span className="sh-legend-item sh-sev-red"><span className="sh-legend-dot" />建议收尾</span>
          <span className="sh-legend-item sh-sev-yellow"><span className="sh-legend-dot" />建议留意</span>
          <span className="sh-legend-item sh-sev-blue"><span className="sh-legend-dot" />继续，留意</span>
          <span className="sh-legend-item sh-sev-green"><span className="sh-legend-dot" />放心继续</span>
          <span className="sh-legend-item"><span className="sh-legend-dot" />无数据</span>
        </div>
        <div className="sh-panel-list">
          {rows === null && loadError === null ? (
            <div className="sh-panel-empty">正在读取各会话健康数据…</div>
          ) : rows === null ? (
            <div className="sh-panel-empty">加载失败：{loadError}</div>
          ) : rows.length === 0 ? (
            <div className="sh-panel-empty">没有可显示的会话</div>
          ) : (
            rows.map(row => {
              const health = row.health
              const severity: HealthSeverity | 'unknown' = health?.severity ?? 'unknown'
              const pct = health?.ratio !== null && health?.ratio !== undefined
                ? Math.min(Math.round(health.ratio * 100), 100)
                : null
              const money = moneyOf(health, isZh)
              const metaBits = [
                pct !== null ? `占用 ${pct}%` : '占用未知',
                health?.effectivePerRound !== null && health?.effectivePerRound !== undefined
                  ? `约 ${compact(health.effectivePerRound)} token/轮`
                  : null,
                health !== null ? `${health.turns} 轮 / ${health.userMessages + health.assistantMessages} 条` : null,
                health !== null && health.compactions > 0 ? `已压缩 ${health.compactions} 次` : null,
                row.live ? '在线' : '冷会话',
              ].filter((v): v is string => v !== null)
              const ariaSev = severity === 'unknown' ? '未知' : SEVERITY_ARIA[severity]
              return (
                <button
                  type="button"
                  key={row.id}
                  className={`sh-panel-row${severity !== 'unknown' ? ` sh-sev-${severity}` : ''}`}
                  onClick={() => openSession(row.id)}
                  aria-label={`会话健康：${ariaSev}。${row.title ?? '未命名会话'}。${metaBits.join('，')}。点击打开并运行 /health`}
                >
                  <span className="sh-row-dot" />
                  <span className="sh-row-main">
                    <span className="sh-row-title">{row.title ?? `未命名会话（${row.id.slice(0, 8)}…）`}</span>
                    <span className="sh-row-meta">{metaBits.join(' · ')}</span>
                  </span>
                  <span className="sh-row-sev">{severity === 'unknown' ? '无数据' : SEVERITY_LABEL[severity]}</span>
                  <span className="sh-row-right">{money ?? ''}</span>
                </button>
              )
            })
          )}
        </div>
        <div className="sh-panel-foot">每 5 秒刷新 · 点击行打开该会话并运行 /health · Esc 关闭</div>
      </div>
    </div>
  )
}

/** Package id — must match package.json `name` and the ModuleLoader handoff. */
export const name = 'dsh-session-health'

/**
 * Required client services. Cordis forbids `ctx.remote` / `ctx.sessions` /
 * `ctx.slots` property reads unless they appear here (topology-sensitive
 * proxy; "cannot get property X without inject"). Both the `remote` root and
 * the `remote.commands` sub-service are injected, mirroring the in-tree
 * convention (ui-goal: ['slots','sessions','remote','remote.goals',...]).
 * There is deliberately NO `remote.sessionHealth`: plugin Remotes never mount
 * client-side, and an injected one would leave the entry pending forever.
 */
export const inject = ['slots', 'sessions', 'remote', 'remote.commands', 'locale']

/**
 * Inject the badge stylesheet the client-modules way: a
 * `<style data-plugin="<id>">` tag on document.head. There is no 'styles'
 * service — in-tree bundles auto-inject CSS Modules as exactly such tags at
 * factory execution (tsdown preset `dsh-css-modules-inline`), and the module
 * system claims untagged tags on materialization while HMR removes
 * `style[data-plugin=<id>]` on unload. The data-plugin-css guard makes the
 * injection idempotent across plugin re-applies.
 */
function injectStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = 'dsh-session-health/badge'
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** Client entry: register the badge + the multi-session overview panel seats. */
export function apply(ctx: ClientContext): void {
  injectStyles()

  const sessions = ctx.sessions as unknown as {
    binding(sessionId: string): { session: { projections: { faceOf(key: string): ProjectionFace | undefined } } } | undefined
    open(id: string): void
  }
  const commands = (ctx.remote as unknown as { commands: CommandsRemote }).commands
  const locale = (ctx as unknown as { locale: { snapshot: { active: string } } }).locale

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
    { name: 'conversation.session.header.utilities', id: 'session-health-dot', order: 10 } as never,
    (props: { sessionId: string }) => (
      <HealthBadge
        sessionId={props.sessionId}
        sessions={sessions}
        commands={commands}
        locale={locale}
      />
    ),
  ) as never)

  // Multi-session overview: the sidebar-foot opener and the frame overlay
  // share one open-state store created per apply (disposed with the fiber —
  // a re-apply starts fresh, an unload takes the registrations with it).
  const overviewStore = new OverviewStore()
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'session-health-overview', order: 10 } as never,
    (props: { wide: boolean }) => (
      <OverviewAction wide={props.wide} store={overviewStore} />
    ),
  ) as never)
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'session-health-overview-panel', order: 10 } as never,
    () => (
      <OverviewPanel
        store={overviewStore}
        sessions={sessions}
        commands={commands}
        locale={locale}
      />
    ),
  ) as never)
}
