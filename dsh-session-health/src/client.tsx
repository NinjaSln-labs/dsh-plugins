/**
 * dsh-session-health — Client half.
 *
 * Renders a session-health badge in `conversation.session.header.utilities`
 * (right side of the session header, next to the Session log button), styled
 * with DSH theme tokens and sized identically to the adjacent button.
 *
 * Data flow (progressive enhancement, zero polling in the common case):
 * 1. Reactive path — subscribes to the host-computed `sessionHealth`
 *    projection (`sessions.binding(...).session.projections.faceOf`), updated
 *    by session/projection push frames the moment the fold changes.
 * 2. Fallback path — when the projection value is absent (registry not
 *    mounted, frame not yet received), the Remote `healthState` RPC seeds the
 *    badge and re-polls on a slow interval (paused while the tab is hidden).
 *
 * Clicking the badge runs `/health` for the full textual report.
 */
import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionHealthProjection, HealthStateResult, HealthSeverity } from './types.ts'
const CSS = `
.sh-wrap{position:relative;display:inline-flex}
.sh-badge{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:6px 12px;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;color:var(--dsw-alias-label-secondary);background:transparent;font-size:13px;font-weight:400;line-height:20px;box-sizing:border-box;cursor:pointer;user-select:none;white-space:nowrap}
.sh-badge:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-badge:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:2px}
.sh-badge .sh-dot{width:10px;height:10px;border-radius:50%;flex:none}
.sh-badge-green{border-color:var(--dsw-alias-state-success-primary)}
.sh-badge-green .sh-dot{background:var(--dsw-alias-state-success-primary)}
.sh-badge-yellow{border-color:var(--dsw-alias-state-warn-primary)}
.sh-badge-yellow .sh-dot{background:var(--dsw-alias-state-warn-primary)}
.sh-badge-red{border-color:var(--dsw-alias-state-error-primary)}
.sh-badge-red .sh-dot{background:var(--dsw-alias-state-error-primary)}
.sh-badge-blue{border-color:var(--dsw-static-blue-500)}
.sh-badge-blue .sh-dot{background:var(--dsw-static-blue-500)}
.sh-badge-unknown{border-color:var(--dsw-alias-border-l2)}
.sh-badge-unknown .sh-dot{background:var(--dsw-alias-label-secondary)}
.sh-tip{position:absolute;top:calc(100% + 8px);right:0;min-width:280px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.22);z-index:50;text-align:left}
.sh-tip-title{font-size:13px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.sh-tip-advice{font-size:13px;line-height:1.6;padding:8px 10px;border-radius:8px;font-weight:600;margin-bottom:8px}
.sh-tip-advice-green{color:var(--dsw-alias-state-success-primary);background:rgba(34,197,94,.12)}
.sh-tip-advice-yellow{color:var(--dsw-alias-state-warn-primary);background:rgba(234,179,8,.14)}
.sh-tip-advice-red{color:var(--dsw-alias-state-error-primary);background:rgba(239,68,68,.12)}
.sh-tip-advice-blue{color:var(--dsw-static-blue-500);background:rgba(59,130,246,.12)}
.sh-tip-row{display:flex;align-items:center;gap:10px;line-height:2}
.sh-tip-row .sh-k{color:var(--dsw-alias-label-secondary);flex:none}
.sh-tip-row .sh-v{color:var(--dsw-alias-label-secondary);margin-left:auto;font-variant-numeric:tabular-nums}
.sh-bar{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;max-width:110px}
.sh-bar-fill{height:100%;border-radius:3px;display:block}
.sh-bar-fill-green{background:var(--dsw-alias-state-success-primary)}
.sh-bar-fill-yellow{background:var(--dsw-alias-state-warn-primary)}
.sh-bar-fill-red{background:var(--dsw-alias-state-error-primary)}
.sh-bar-fill-blue{background:var(--dsw-static-blue-500)}
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

const SEVERITY_LABEL: Record<HealthSeverity, string> = {
  green: '绿（放心继续）',
  blue: '蓝（继续，留意）',
  yellow: '黄（建议留意）',
  red: '红（建议收尾）',
}

const FALLBACK_ADVICE: Record<HealthSeverity, string> = {
  green: '空间充足，放心继续。',
  blue: '占用中等，继续但留意窗口压力。',
  yellow: '若剩余工作还多，开新会话更划算。',
  red: '建议尽快在任务边界收尾。',
}

const stateToken = (c: string) =>
  c === 'green' ? 'var(--dsw-alias-state-success-primary)'
  : c === 'yellow' ? 'var(--dsw-alias-state-warn-primary)'
  : c === 'blue' ? 'var(--dsw-static-blue-500)'
  : 'var(--dsw-alias-state-error-primary)'

/** Projection face shape from the runtime client. */
interface ProjectionFace {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

/** Minimal Remote face — the generated ./remote types give the full contract. */
export interface HealthRemote {
  healthState(request: { sessionId: string }): Promise<unknown>
}

function HealthBadge(props: {
  sessionId: string
  remote: HealthRemote
  commandsRemote?: { execute(sessionId: string, line: string): unknown }
  sessions?: {
    binding(sessionId: string): { session: { projections: { faceOf(key: string): ProjectionFace | undefined } } } | undefined
  }
  timer?: { interval(fn: () => void, delay: number): () => void }
}): JSX.Element {
  const [proj, setProj] = React.useState<SessionHealthProjection | undefined>(undefined)
  const [remoteHealth, setRemoteHealth] = React.useState<HealthStateResult | null>(null)
  const [hover, setHover] = React.useState(false)

  React.useEffect(() => {
    let alive = true

    // 1) Reactive projection path — push frames, no polling.
    const face = props.sessions?.binding?.(props.sessionId)?.session?.projections?.faceOf?.('sessionHealth')
    let off: (() => void) | undefined
    if (face !== undefined) {
      const read = () => {
        if (!alive) return
        const v = face.getSnapshot()
        if (v !== undefined && v !== null) setProj(v as SessionHealthProjection)
      }
      read()
      off = face.subscribe(read)
    }

    // 2) Remote fallback — seeds/polls only while the projection is absent,
    //    paused while the tab is hidden.
    const fetchRemote = async () => {
      if (document.hidden) return
      try {
        const h = await props.remote.healthState({ sessionId: props.sessionId })
        if (alive && h !== null && typeof h === 'object') setRemoteHealth(h as HealthStateResult)
      } catch { /* 静默 */ }
    }
    fetchRemote()
    const dispose = props.timer !== undefined ? props.timer.interval(fetchRemote, 30000) : null

    return () => {
      alive = false
      if (off) off()
      if (dispose) dispose()
    }
  }, [props.sessionId])

  // Effective view: projection wins; Remote fallback fills the gap.
  const severity: HealthSeverity | 'unknown' = proj?.severity ?? remoteHealth?.color ?? 'unknown'
  const ratio = proj?.ratio ?? remoteHealth?.ratio ?? null
  const total = proj?.total ?? remoteHealth?.total ?? null
  const windowTokens = proj?.window ?? remoteHealth?.window ?? null
  const pct = ratio !== null ? Math.min(Math.round(ratio * 100), 100) : null

  const runHealth = () => {
    try { props.commandsRemote?.execute?.(props.sessionId, '/health') } catch { /* 静默 */ }
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
    const color = severity === 'unknown' ? 'green' : severity
    const label = severity === 'unknown' ? '未知（等待数据）' : SEVERITY_LABEL[severity]
    const advice = proj?.advice ?? (severity === 'unknown' ? '正在获取会话健康数据…' : FALLBACK_ADVICE[severity])
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
          <span className="sh-v">约 {compact(total)} token</span>
        </div>
        <div className="sh-tip-row">
          <span className="sh-k">模型窗口</span>
          <span className="sh-v">{compact(windowTokens)}</span>
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
        className={`sh-badge sh-badge-${state}`}
        role="button"
        tabIndex={0}
        aria-label={`会话健康：${severity === 'unknown' ? '未知' : SEVERITY_LABEL[severity]}`}
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

/** Client entry: register the badge in the session header utilities seat. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => { const s = ctx.get('styles'); if (s !== undefined) return s.insert(CSS); return () => {} }, 'dsh-session-health: styles')
  const slots = ctx.get('slots') as unknown as {
    inject(name: string, fn: () => unknown): unknown
    register(...args: unknown[]): unknown
  } | undefined
  if (slots === undefined) return
  const timer = ctx.get('timer') as { interval(fn: () => void, delay: number): () => void } | undefined
  const remoteRoot = (ctx as unknown as {
    remote: {
      sessionHealth: HealthRemote
      commands?: { execute(sessionId: string, line: string): unknown }
    }
  }).remote
  const sessions = (ctx as unknown as {
    sessions: {
      binding(sessionId: string): { session: { projections: { faceOf(key: string): ProjectionFace | undefined } } } | undefined
    }
  }).sessions
  slots.inject('conversation.session.header.utilities', () => slots.register(
    { name: 'conversation.session.header.utilities', id: 'session-health-dot', order: 10 } as never,
    (props: { sessionId: string }) => (
      <HealthBadge
        sessionId={props.sessionId}
        remote={remoteRoot.sessionHealth}
        commandsRemote={remoteRoot.commands}
        sessions={sessions}
        timer={timer}
      />
    ),
  ) as never)
}
