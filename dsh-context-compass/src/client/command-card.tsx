/** dsh-context-compass — /compass rich card (commandview seat) (extracted). */
import * as React from 'react'
import { SEVERITY_LABEL, parseCompassReport } from './shared.ts'

/** 命令触发时间 → HH:MM:SS（跨天则 MM-DD HH:MM），连续卡片的分隔标识。 */
function commandTimeLabel(time: number | undefined): string | null {
  if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return null
  const d = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? hhmm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}`
}

/**
 * The /compass rich card: severity chip + conclusion + reason, key metric
 * rows, the real handoff checklist, and the full report in a <pre> body
 * (the default card's own body is a <pre> too — no markdown renderer
 * involved). Running/error states degrade to the generic text row. The head
 * carries the trigger time so consecutive cards read as separate actions.
 */
export function CompassCommandCard(props: {
  node: {
    name?: string | null
    time?: number
    outcome?: { kind?: string; text?: string } | null
  }
}): JSX.Element {
  // 默认收起：完整报告（<pre> 正文）默认折叠，头部结论/指标一眼可见，
  // 需要细节再展开——多张卡并排时不再整页高度堆叠。
  const [expanded, setExpanded] = React.useState(false)
  const outcome = props.node.outcome
  const text = outcome?.text
  const timeLabel = commandTimeLabel(props.node.time)
  const timeTag = timeLabel !== null ? <span className="sh-ccard-time">{timeLabel}</span> : null
  if (outcome === null || outcome === undefined) {
    return (
      <div className="sh-ccard">
        <div className="sh-ccard-head"><span className="sh-ccard-title">/compass</span><span className="sh-ccard-state">运行中…</span>{timeTag}</div>
      </div>
    )
  }
  if (outcome.kind !== 'success' || text === undefined || text === '') {
    return (
      <div className="sh-ccard" data-error="true">
        <div className="sh-ccard-head">
          <span className="sh-ccard-title">/compass</span>
          <span className="sh-ccard-state">执行失败</span>
          {timeTag}
          {text !== undefined ? (
            <button
              type="button"
              className="sh-ccard-toggle"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? '收起失败详情' : '展开失败详情'}
            >
              {expanded ? '收起' : '展开'}
            </button>
          ) : null}
        </div>
        {expanded && text !== undefined ? <pre className="sh-ccard-body">{text}</pre> : null}
      </div>
    )
  }
  const report = parseCompassReport(text)
  const sev = report.severity
  return (
    <div className={`sh-ccard${sev !== null ? ` sh-sev-${sev}` : ''}`}>
      <div className="sh-ccard-head">
        <span className="sh-ccard-title">/compass</span>
        {sev !== null ? <span className="sh-sev-chip"><span className="sh-row-dot" />{SEVERITY_LABEL[sev]}</span> : null}
        <span className="sh-ccard-summary">{report.summary}</span>
        {timeTag}
        <button
          type="button"
          className="sh-ccard-toggle"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? '收起完整报告' : '展开完整报告'}
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      {report.reason !== '' ? <div className="sh-ccard-reason">{report.reason}</div> : null}
      {report.metrics.length > 0 ? (
        <div className="sh-ccard-metrics">
          {report.metrics.map((m, i) => {
            const colon = m.indexOf('：')
            const key = colon > 0 ? m.slice(0, colon) : null
            const value = colon > 0 ? m.slice(colon + 1) : m
            return key !== null
              ? (
                <span key={i} className="sh-ccard-metric">
                  <span className="sh-ccard-mkey">{key}</span>
                  <span className="sh-ccard-mval">{value}</span>
                </span>
              )
              : <span key={i} className="sh-ccard-metric sh-ccard-mfull">{m}</span>
          })}
        </div>
      ) : null}
      {report.checklist.length > 0 ? (
        <ul className="sh-ccard-checklist">
          {report.checklist.map((c, i) => (
            <li key={i} className={c.startsWith('- [x]') ? 'sh-ccard-cdone' : 'sh-ccard-copen'}>{c.slice(5)}</li>
          ))}
        </ul>
      ) : null}
      {expanded ? <pre className="sh-ccard-body">{text}</pre> : null}
    </div>
  )
}
