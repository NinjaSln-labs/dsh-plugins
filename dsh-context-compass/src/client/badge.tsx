/** dsh-context-compass — session-health header badge + hover tooltip (extracted). */
import * as React from 'react'
import type { SessionHealthProjection, HealthSeverity } from '../types.ts'
import { cacheHitRateOf, type TokenUsageLike } from '../usage.ts'
import { formatUsd, formatCny, formatHitRate } from '../util.ts'
import { compact, SEVERITY_LABEL, SEVERITY_ARIA, mergePressure, lagOf, type ProjectionFace, type ContextPressureLike, type CommandsRemote } from './shared.ts'

export function HealthBadge(props: {
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
    try { return window.localStorage.getItem('dsh-context-compass/costDisplay') === 'tokens' } catch { return false }
  })
  // 交接摘要复制反馈（B3）：点击 → RPC 取真实摘要 → 剪贴板 → 短暂显示「已复制」。
  const [copied, setCopied] = React.useState(false)
  // 浮层信息分层（B2）：核心行（占用/每轮/预计下次/计费）默认，次要行
  // （窗口/规模/压缩）折叠在「更多详情」。
  const [showMore, setShowMore] = React.useState(false)
  const copiedTimer = React.useRef<number | null>(null)
  const mountedRef = React.useRef(true)
  const copySummary = () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    const finish = (ok: boolean) => {
      if (!mountedRef.current) return // 浮层关闭/组件卸载后不再 setState
      setCopied(ok)
      copiedTimer.current = window.setTimeout(() => {
        if (mountedRef.current) setCopied(false)
      }, 2000)
    }
    try {
      void fetch('/context-compass-rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'summary', sessionId: props.sessionId }),
      }).then(res => res.json()).then(async (json: { ok?: boolean; result?: { text?: string } }) => {
        const text = json.ok === true ? json.result?.text : undefined
        if (typeof text !== 'string' || text === '') { finish(false); return }
        try {
          await navigator.clipboard.writeText(text)
          finish(true)
        } catch { finish(false) }
      }).catch(() => finish(false))
    } catch { finish(false) }
  }
  React.useEffect(() => () => {
    mountedRef.current = false
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
  }, [])
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
  // displayed occupancy merges in token-meter's compaction-aware numbers —
  // the occupancy figure is "what the next request costs", not a stale
  // pre-compaction sample. After a compaction the projected next-request
  // cost drives the bar/% while the verdict still rides last-wins pressure;
  // lagOf() annotates that divergence (roadmap: 压缩后判定滞后标注).
  const merged = mergePressure(proj, pressure)
  const severity: HealthSeverity | 'unknown' = proj?.severity ?? 'unknown'
  const displayRatio = merged.projected !== null && merged.window !== null && merged.window > 0
    ? merged.projected / merged.window
    : merged.ratio
  const pct = displayRatio !== null ? Math.min(Math.round(displayRatio * 100), 100) : null
  const lag = lagOf(proj, pressure)

  const runHealth = () => {
    try { void props.commands.execute(props.sessionId, '/compass') } catch { /* 静默 */ }
  }
  const toggleCost = () => {
    setCostAsTokens(v => {
      const next = !v
      try { window.localStorage.setItem('dsh-context-compass/costDisplay', next ? 'tokens' : 'money') } catch { /* 静默 */ }
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
  const text = '上下文' + (pct !== null ? ` ${pct}%` : '')

  let tip: JSX.Element | null = null
  if (hover) {
    const color = severity === 'unknown' ? null : severity
    const label = severity === 'unknown' ? '未知（等待数据）' : SEVERITY_LABEL[severity]
    const advice = proj?.advice ?? '正在获取上下文罗盘数据…'
    const bar = (
      <span className="sh-bar">
        <span className="sh-bar-fill" style={{ width: `${pct !== null ? Math.min(pct, 100) : 0}%` }} />
      </span>
    )
    tip = (
      <div className={`sh-tip${color !== null ? ` sh-sev-${color}` : ''}`}>
        <div className="sh-tip-title">
          上下文罗盘：
          <span className="sh-sev-label">{label}</span>
        </div>
        <div className="sh-tip-advice">{advice}</div>
        <div className="sh-tip-row">
          <span className="sh-k">上下文占用</span>
          {bar}
          <span className="sh-v">{pct !== null ? `${pct}%` : '未知'}</span>
        </div>
        {(() => {
          // R1 占用趋势 sparkline：投影的 pressureHistory（≤40 个压力采样，
          // 每次带 inputTokens 的 usage 报告一个）。归一口径：优先除以当前
          // 窗口（趋势即逼近满窗），窗口未知时除以序列峰值（只看形状）。
          // 少于 2 个点不成趋势，隐藏。
          const hist = proj?.pressureHistory ?? []
          if (hist.length < 2) return null
          const win = merged.window ?? proj?.window ?? null
          const denom = win !== null && win > 0 ? win : Math.max(...hist, 1)
          const pts = hist
            .map((v, i) => `${((i / (hist.length - 1)) * 100).toFixed(1)},${(100 - (Math.min(v / denom, 1) * 100)).toFixed(1)}`)
            .join(' ')
          return (
            <svg
              className="sh-spark"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              role="img"
              aria-label={`占用趋势（最近 ${hist.length} 个采样）`}
            >
              <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
          )
        })()}
        <div className="sh-tip-row">
          <span className="sh-k">每轮输入</span>
          <span className="sh-v">约 {compact(merged.total)} token{(() => { const rate = cacheHitRateOf(usage); return rate !== null ? `（缓存命中 ${formatHitRate(rate)}）` : '' })()}</span>
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
            ? formatCny(cny)
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
        {/* 已压缩是核心信号（A1 压缩比例 + 滞后提示的前提），留在默认视图，
            不进「更多详情」折叠——只折叠纯信息行（窗口/规模）。 */}
        {proj !== undefined && proj.compactions > 0 ? (
          <div className="sh-tip-row">
            <span className="sh-k">已压缩</span>
            <span className="sh-v">
              {proj.compactions} 次
              {proj.compressionRatio !== null && proj.compressionRatio !== undefined
                ? `（上次压缩比例 ≈ ${Math.round(proj.compressionRatio * 100)}%，快照口径）`
                : ''}
            </span>
          </div>
        ) : null}
        {showMore ? (
          <>
            <div className="sh-tip-row">
              <span className="sh-k">模型窗口</span>
              <span className="sh-v">{compact(merged.window)}</span>
            </div>
            {proj !== undefined ? (
              <div className="sh-tip-row">
                <span className="sh-k">会话规模</span>
                <span className="sh-v">{proj.turns} 轮 / {proj.userMessages + proj.assistantMessages} 条消息</span>
              </div>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          className="sh-tip-more"
          onClick={() => setShowMore(v => !v)}
          aria-expanded={showMore}
        >
          {showMore ? '收起详情' : '更多详情'}
        </button>
        {lag.lag ? (
          <div className="sh-tip-lag" role="note">
            压缩后判定滞后：判定基于压缩前压力（{lag.oldPct}%），预计下次请求后更新（≈ {lag.newPct}%）
          </div>
        ) : null}
        <div className="sh-tip-copy-row">
          <button
            type="button"
            className={`sh-tip-copy${copied ? ' sh-tip-copy-done' : ''}`}
            onClick={copySummary}
            aria-label={copied ? '交接摘要已复制' : '复制交接摘要'}
            title="复制含真实交接状态的摘要文本"
          >
            {copied ? '✓ 已复制交接摘要' : '复制交接摘要'}
          </button>
        </div>
        <div className="sh-tip-hint">点击运行 /compass 查看完整报告；点击计费预期切换金额 / token 显示</div>
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
        aria-label={`上下文罗盘：${severity === 'unknown' ? '未知' : SEVERITY_ARIA[severity]}`}
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
