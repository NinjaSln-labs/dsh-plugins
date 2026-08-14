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
import type { SessionHealthProjection, HealthSeverity } from './types.ts'

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
.sh-bar{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;max-width:110px}
.sh-bar-fill{height:100%;border-radius:3px;display:block;background:var(--sh-accent,var(--dsw-alias-label-secondary))}
.sh-tip-hint{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px}
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

/** Hit rate display: floored integer percent — 0.9993 -> '99%' (true lower bound, never a fake 100%). The raw 0..1 value stays in the data. */
function pctOf(rate: number): string {
  return `${Math.floor(rate * 100)}%`
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
  const [hover, setHover] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    // Projection push path — frames update the badge the moment the host fold
    // changes. Absence of a value means "no frame yet" (gray state), never a
    // reason to poll: the projection seam is the only client data path.
    const binding = props.sessions.binding?.(props.sessionId)?.session?.projections
    const face = binding?.faceOf?.('sessionHealth')
    const pressureFace = binding?.faceOf?.('contextPressure')
    if (face === undefined && pressureFace === undefined) return () => { alive = false }
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
    readHealth()
    readPressure()
    const offs = [
      face !== undefined ? face.subscribe(readHealth) : () => {},
      pressureFace !== undefined ? pressureFace.subscribe(readPressure) : () => {},
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
          <span className="sh-v">约 {compact(merged.total)} token{proj?.cacheHitRate !== null && proj?.cacheHitRate !== undefined ? `（缓存命中 ${pctOf(proj.cacheHitRate)}）` : ''}</span>
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
          const period = proj?.pricePeriod === 'peak' ? '（忙时价）' : proj?.pricePeriod === 'offpeak' ? '（闲时价）' : ''
          if (money === null) return null
          return (
            <div className="sh-tip-row">
              <span className="sh-k">计费预期</span>
              <span className="sh-v">约 {money}/轮（含缓存折扣）{period}</span>
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
        <div className="sh-tip-hint">点击运行 /health 查看完整报告</div>
      </div>
    )
  }

  return (
    <span
      className="sh-wrap"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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

/** Client entry: register the badge in the session header utilities seat. */
export function apply(ctx: ClientContext): void {
  injectStyles()

  const sessions = ctx.sessions as unknown as {
    binding(sessionId: string): { session: { projections: { faceOf(key: string): ProjectionFace | undefined } } } | undefined
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
}
