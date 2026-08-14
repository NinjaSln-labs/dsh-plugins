/**
 * dsh-session-health — Client half.
 *
 * Renders a session-health badge in `conversation.session.header.utilities`
 * (right side of the session header, next to the Session log button), styled
 * with DSH theme tokens and sized identically to the adjacent button.
 *
 * Data flows over the package Remote: ctx.remote.sessionHealth.healthState().
 */
import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { HealthStateResult } from './types.ts'

const CSS = `
.sh-wrap{position:relative;display:inline-flex}
.sh-badge{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:6px 12px;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;color:var(--dsw-alias-label-secondary);background:transparent;font-size:13px;font-weight:400;line-height:20px;box-sizing:border-box;cursor:pointer;user-select:none;white-space:nowrap}
.sh-badge:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-badge .sh-dot{width:10px;height:10px;border-radius:50%;flex:none}
.sh-badge-green{border-color:var(--dsw-alias-state-success-primary)}
.sh-badge-green .sh-dot{background:var(--dsw-alias-state-success-primary)}
.sh-badge-yellow{border-color:var(--dsw-alias-state-warn-primary)}
.sh-badge-yellow .sh-dot{background:var(--dsw-alias-state-warn-primary)}
.sh-badge-red{border-color:var(--dsw-alias-state-error-primary)}
.sh-badge-red .sh-dot{background:var(--dsw-alias-state-error-primary)}
.sh-badge-unknown{border-color:var(--dsw-alias-border-l2)}
.sh-badge-unknown .sh-dot{background:var(--dsw-alias-label-secondary)}
.sh-tip{position:absolute;top:calc(100% + 8px);right:0;min-width:260px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.22);z-index:50;text-align:left}
.sh-tip-title{font-size:13px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.sh-tip-advice{font-size:13px;line-height:1.6;padding:8px 10px;border-radius:8px;font-weight:600;margin-bottom:8px}
.sh-tip-advice-green{color:var(--dsw-alias-state-success-primary);background:rgba(34,197,94,.12)}
.sh-tip-advice-yellow{color:var(--dsw-alias-state-warn-primary);background:rgba(234,179,8,.14)}
.sh-tip-advice-red{color:var(--dsw-alias-state-error-primary);background:rgba(239,68,68,.12)}
.sh-tip-row{display:flex;align-items:center;gap:10px;line-height:2}
.sh-tip-row .sh-k{color:var(--dsw-alias-label-secondary);flex:none}
.sh-tip-row .sh-v{color:var(--dsw-alias-label-secondary);margin-left:auto;font-variant-numeric:tabular-nums}
.sh-bar{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;max-width:110px}
.sh-bar-fill{height:100%;border-radius:3px;display:block}
.sh-bar-fill-green{background:var(--dsw-alias-state-success-primary)}
.sh-bar-fill-yellow{background:var(--dsw-alias-state-warn-primary)}
.sh-bar-fill-red{background:var(--dsw-alias-state-error-primary)}
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

const stateToken = (c: string) =>
  c === 'green' ? 'var(--dsw-alias-state-success-primary)'
  : c === 'yellow' ? 'var(--dsw-alias-state-warn-primary)'
  : 'var(--dsw-alias-state-error-primary)'

function HealthBadge(props: { sessionId: string; remote: HealthRemote; timer: { interval(fn: () => void, delay: number): () => void } | undefined }): JSX.Element {
  const [health, setHealth] = React.useState<HealthStateResult | null>(null)
  const [hover, setHover] = React.useState(false)

  React.useEffect(() => {
    let alive = true
    const fetchHealth = async () => {
      try {
        const h = await props.remote.healthState({ sessionId: props.sessionId })
        if (alive && h && typeof h === 'object') setHealth(h as HealthStateResult)
      } catch { /* 静默 */ }
    }
    fetchHealth()
    const dispose = props.timer !== undefined ? props.timer.interval(fetchHealth, 30000) : null
    return () => { alive = false; if (dispose) dispose() }
  }, [props.sessionId])

  const state = health === null ? 'unknown' : health.color || 'unknown'
  const text = health === null ? '会话健康：…' : '会话健康'

  let tip: JSX.Element | null = null
  if (health !== null && hover) {
    const color = health.color
    const label = color === 'green' ? '绿（放心继续）' : color === 'yellow' ? '黄（建议留意）' : '红（建议收尾）'
    const pct = typeof health.ratio === 'number' ? Math.round(health.ratio * 100) : null
    const advice = color === 'green' ? '空间充足，放心继续。' : color === 'yellow' ? '若剩余工作还多，开新会话更划算。' : '建议尽快在任务边界收尾。'
    const bar = (
      <span className="sh-bar">
        <span className={`sh-bar-fill sh-bar-fill-${color}`} style={{ width: `${pct !== null ? Math.min(pct, 100) : 0}%` }} />
      </span>
    )
    tip = (
      <div className="sh-tip">
        <div className="sh-tip-title">
          会话健康：
          <span style={{ color: stateToken(color), fontWeight: 600 }}>{label}</span>
        </div>
        <div className={`sh-tip-advice sh-tip-advice-${color}`}>{advice}</div>
        <div className="sh-tip-row">
          <span className="sh-k">上下文占用</span>
          {bar}
          <span className="sh-v">{pct !== null ? `${pct}%` : '未知'}</span>
        </div>
        <div className="sh-tip-row">
          <span className="sh-k">每轮输入</span>
          <span className="sh-v">约 {compact(health.total)} token</span>
        </div>
        <div className="sh-tip-row">
          <span className="sh-k">模型窗口</span>
          <span className="sh-v">{compact(health.window)}</span>
        </div>
      </div>
    )
  }

  return (
    <span
      className="sh-wrap"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className={`sh-badge sh-badge-${state}`}>
        <span className="sh-dot" />
        <span>{text}</span>
      </span>
      {tip}
    </span>
  )
}

/** Minimal Remote face — the generated ./remote types give the full contract. */
export interface HealthRemote {
  healthState(request: { sessionId: string }): Promise<unknown>
}

/** Client entry: register the badge in the session header utilities seat. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => { const s = ctx.get('styles'); if (s !== undefined) return s.insert(CSS); return () => {} }, 'dsh-session-health: styles')
  const slots = ctx.get('slots') as unknown as {
    inject(name: string, fn: () => unknown): unknown
  } | undefined
  if (slots === undefined) return
  const timer = ctx.get('timer') as { interval(fn: () => void, delay: number): () => void } | undefined
  const remote = (ctx as unknown as { remote: { sessionHealth: HealthRemote } }).remote.sessionHealth
  slots.inject('conversation.session.header.utilities', () => slots.register(
    { name: 'conversation.session.header.utilities', id: 'session-health-dot', order: 10 } as never,
    (props: { sessionId: string }) => (
      <HealthBadge
        sessionId={props.sessionId}
        remote={remote}
        timer={timer}
      />
    ),
  ) as never)
}
