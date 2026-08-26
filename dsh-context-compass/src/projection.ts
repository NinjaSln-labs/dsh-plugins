/**
 * dsh-context-compass — the sessionHealth projection unit.
 *
 * A pure event fold with zero dependencies on other units: turns / messages /
 * compaction count from session events, plus last-wins provider pressure and
 * context window (the same events token-meter's units listen to). The view
 * applies the config thresholds and emits the severity + advice the badge
 * renders reactively — no polling, no per-refresh RPC.
 *
 * The pressure figure is the raw provider-anchored prompt-side sample
 * (input + cache traffic, no output), NOT the compaction-aware repricing
 * token-meter's contextPressure projection computes. When both units are
 * mounted the client prefers `contextPressure.projectedTokens` for the
 * occupancy bar and uses this unit for the verdict + counts.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { sessionHealthProjectionSchema } from './schemas.ts'
import type { HealthSeverity, SessionHealthProjection } from './types.ts'
import { readConfig, type ConfigSource, type ResolvedConfig } from './config.ts'
import type { PricePeriod, ResolvedPricing } from './pricing.ts'
import { formatCompact } from './util.ts'

/**
 * 平均每 X 轮压缩一次 —— turns / compactions 取整，供「已压缩 N 次」补
 * 「约每 X 轮一次」。防御：compactions ≤ 0 / turns 非有限或 ≤ 0 / 商非有限
 * 均返回 null（不展示频率，仅保留原有文案）；商 < 1 取 1（每轮都不足一次，
 * 表示压缩频繁）。
 */
export function compactIntervalRounds(turns: number, compactions: number): number | null {
  if (!(compactions > 0)) return null
  if (!Number.isFinite(turns) || turns <= 0) return null
  const per = turns / compactions
  if (!Number.isFinite(per)) return null
  const rounded = Math.round(per)
  return rounded < 1 ? 1 : rounded
}

/**
 * R1 sparkline: how many recent pressure samples the fold keeps. One sample
 * per usage report that carried inputTokens (≈ one model request); 40 covers
 * a long session's recent trend without growing the persisted state unboundedly.
 */
export const PRESSURE_HISTORY_CAP = 40

/** Fold state (plain JSON per the unit contract — persisted-cache precondition). */
export interface SessionHealthState {
  turns: number
  lastTurn: number | null
  userMessages: number
  assistantMessages: number
  compactions: number
  pressureTokens?: number
  contextWindow?: number
  /**
   * R1 sparkline source: the last ≤ PRESSURE_HISTORY_CAP prompt-side pressure
   * samples, oldest first. Appended on the same usage reports that update
   * `pressureTokens`; a plain array (JSON contract) capped with slice.
   */
  pressureHistory?: number[]
  /**
   * (turn, step) of the most recent pressureHistory sample — the R1 dedup key
   * (a streamed step emits chunk-usage early + message-usage final; the second
   * arrival replaces instead of appending).
   */
  lastSample?: { turn: number; step: number }
  /**
   * Pressure snapshot captured when `compaction/end` arrived — the "pre"
   * side of the compression-ratio inference. Consumed by the first usage
   * sample after the fold (the "post" side); never set while no pressure is
   * known. The inference rides pressure snapshots only, never event payloads.
   */
  preCompactionPressure?: number
  /**
   * Last inferred compression ratio 1 − post/pre (0..1); null when the last
   * fold was inconclusive (pressure did not drop after compaction).
   */
  compressionRatio?: number | null
  /** Buckets of the most recent usage report (per-round money math). */
  lastUsage?: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
}

function init(): SessionHealthState {
  return { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
}

/**
 * Prompt-side pressure of one usage report: input plus cache traffic, no
 * output. The caller guards `inputTokens` presence (streaming usage chunks
 * often omit it); this helper itself stays total-safe.
 */
function pressureOf(usage: { inputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }): number {
  return (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/** The last-wins bucket record of one usage report. */
function bucketsOf(usage: { inputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number }): SessionHealthState['lastUsage'] {
  return {
    inputTokens: usage.inputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/**
 * Fold the compression-ratio inference: the FIRST usage sample after a
 * `compaction/end` is the post-compaction pressure; the pre side was
 * captured when the fold event arrived. Caliber: 1 − post/pre from pressure
 * snapshots — an estimate, not exact compaction statistics (the event
 * carries no payload). A fold that did not lower pressure is inconclusive
 * (new content overwhelmed the gain) and reads as null, never a fake 0.
 */
function foldCompression(state: SessionHealthState, post: number): SessionHealthState {
  const pre = state.preCompactionPressure
  if (pre === undefined || pre <= 0) return state
  const next = { ...state }
  delete next.preCompactionPressure
  next.compressionRatio = post < pre ? Math.min(1, 1 - post / pre) : null
  return next
}

/** Pure transition: previous state + one committed event → next state. */
export function applyHealthEvent(state: SessionHealthState, event: SessionEvent): SessionHealthState {
  // Compaction events are appended by the compaction plugin and are not part
  // of the dsh-session union, so they are matched by name (same approach as
  // token-meter's surface fold).
  if ((event as { type?: string }).type === 'compaction/end') {
    const next: SessionHealthState = { ...state, compactions: state.compactions + 1 }
    // Capture the pre-compaction pressure so the next usage sample can infer
    // the ratio — no event payload involved.
    if (typeof state.pressureTokens === 'number' && state.pressureTokens > 0) {
      next.preCompactionPressure = state.pressureTokens
    } else {
      // 无法捕获 pre（无压力样本）→ 本次推理不可判定；陈旧比例不再冒充
      // 「上次压缩比例」（AUDIT R1-3）。
      next.compressionRatio = null
    }
    return next
  }
  switch (event.type) {
    case 'step/end': {
      // Distinct turns only (step/end is the step lifecycle authority).
      if (state.lastTurn === event.data.turn) return state
      return { ...state, turns: state.turns + 1, lastTurn: event.data.turn }
    }
    case 'user/message':
      return { ...state, userMessages: state.userMessages + 1 }
    case 'assistant/message': {
      const next = { ...state, assistantMessages: state.assistantMessages + 1 }
      const u = event.data.usage
      // 缺 inputTokens 的 usage 报告不完整（流式常只报部分字段）——跳过，
      // 不覆盖已有压力，也不产生 NaN/0 污染。
      if (u === undefined || typeof u.inputTokens !== 'number') return next
      const post = pressureOf(u)
      const sample = pushSample(state, event.data.turn, event.data.step, post)
      return foldCompression(
        { ...next, pressureTokens: post, lastUsage: bucketsOf(u), pressureHistory: sample.history, lastSample: sample.last },
        post,
      )
    }
    case 'assistant/chunk': {
      if (event.data.chunk.type !== 'usage') return state
      const u = event.data.chunk.usage
      if (typeof u.inputTokens !== 'number') return state
      const post = pressureOf(u)
      const sample = pushSample(state, event.data.turn, event.data.step, post)
      return foldCompression(
        { ...state, pressureTokens: post, lastUsage: bucketsOf(u), pressureHistory: sample.history, lastSample: sample.last },
        post,
      )
    }
    case 'request/context': {
      if (event.data.contextWindow === undefined) return state
      return { ...state, contextWindow: event.data.contextWindow }
    }
    default:
      return state
  }
}

/**
 * Wire-boundary coercion (S2, ROADMAP 0.8.0): the view is the only seam where
 * persisted state meets the wire schema, and the schema is strict (integers,
 * non-negative, finite). States written by an older same-version build — or
 * any degenerate JSON — must fold into a schema-valid view, never a throw or
 * a NaN. Every state field passes through one of these two coercers; the
 * fold itself stays trust-our-own-writer (states only come from apply).
 */
function finiteNonNeg(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/** Non-negative safe integer for the wire count fields (null/NaN → 0). */
function countOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/**
 * R1 sparkline: record one pressure sample, capped to the most recent CAP
 * entries. Dedup by (turn, step), aligned with token-meter's口径: a streamed
 * step emits `assistant/chunk(usage)` early and `assistant/message` with the
 * same step's final usage — the second arrival REPLACES the first instead of
 * double-writing (AUDIT R1-1).
 */
function pushSample(
  state: SessionHealthState,
  turn: number,
  step: number,
  post: number,
): { history: number[]; last: { turn: number; step: number } | undefined } {
  // Only dedup on a real (turn, step) key — synthetic/legacy events without
  // one must never collapse into the same sample.
  if (Number.isInteger(turn) && Number.isInteger(step)) {
    const last = state.lastSample
    if (last !== undefined && last.turn === turn && last.step === step) {
      const history = state.pressureHistory ?? []
      return { history: history.length === 0 ? [post] : [...history.slice(0, -1), post], last }
    }
    return { history: [...(state.pressureHistory ?? []), post].slice(-PRESSURE_HISTORY_CAP), last: { turn, step } }
  }
  return { history: [...(state.pressureHistory ?? []), post].slice(-PRESSURE_HISTORY_CAP), last: state.lastSample }
}

/**
 * State → wire payload: severity + advice from the config thresholds.
 *
 * Priority mirrors the skill: economy (per-round billable cost, paid every
 * round) outranks capacity (window ratio); the message-count proxy annotates
 * only at the bottom tier (green → blue). The economy trigger bills the same
 * cache-discounted figure the badge displays (`effectivePerRound`), and its
 * floor scales with the model window — the 50K absolute default was
 * calibrated for ~128K-window models and would otherwise fire at single-digit
 * occupancy on 1M windows. The exact threshold values live in config, never
 * here.
 */
export function healthView(
  state: SessionHealthState,
  config: ResolvedConfig,
  price?: ResolvedPricing,
): SessionHealthProjection {
  const total = finiteNonNeg(state.pressureTokens)
  const window = finiteNonNeg(state.contextWindow)
  const ratio = total !== null && window !== null && window > 0 ? total / window : null
  const t = config.thresholds

  // Last-request buckets for the per-round money math. The cache-hit RATE is
  // deliberately NOT computed here: it lives in src/usage.ts and both the
  // badge and /compass read the core `tokenUsage` projection (the same value
  // the input-bar stats line shows) — one data source, one algorithm spot.
  const lastUsage = state.lastUsage
  const uncachedInputTokens = finiteNonNeg(lastUsage?.inputTokens)
  const cacheReadTokens = finiteNonNeg(lastUsage?.cacheReadTokens)
  // Money math: with an official pricing document the cache-hit ratio comes
  // from the official USD pair and each currency uses its own official miss
  // price (zh docs: CNY, en docs: USD — no conversion); static mode uses the
  // config's flat USD values.
  const missPerMUsd = price !== undefined ? price.missPerMUsd : config.cost.inputPricePerM
  const hitPerMUsd = price !== undefined ? price.hitPerMUsd : missPerMUsd * config.cost.cacheHitDiscount
  const discount = missPerMUsd > 0 ? hitPerMUsd / missPerMUsd : config.cost.cacheHitDiscount
  const effectivePerRound = uncachedInputTokens !== null && cacheReadTokens !== null
    ? uncachedInputTokens + cacheReadTokens * discount
    : null
  const effectivePerRoundUsd = effectivePerRound !== null
    ? effectivePerRound * missPerMUsd / 1_000_000
    : null
  const effectivePerRoundCny = effectivePerRound !== null && price?.missPerMCny !== null && price?.missPerMCny !== undefined
    ? effectivePerRound * price.missPerMCny / 1_000_000
    : null
  const pricePeriod: PricePeriod = price?.period ?? null

  // Severity ladder. Economy = billable-equivalent per round (what the badge
  // money row shows) against a floor that grows with the window:
  // max(economyTokenFloor, economyWindowRatio × window).
  const capacityHigh = ratio !== null && ratio >= t.windowHigh
  const economyFloor = window !== null && window > 0
    ? Math.max(t.economyTokenFloor, window * t.economyWindowRatio)
    : t.economyTokenFloor
  const economy = effectivePerRound !== null && effectivePerRound >= economyFloor
  let severity: HealthSeverity = 'green'
  if (ratio !== null && ratio >= t.windowCritical) severity = 'red'
  else if (capacityHigh || economy) severity = 'yellow'
  else if (ratio !== null && ratio >= t.windowMid) severity = 'blue'

  // Message-count proxy (dimension-A annotation): a very long message history
  // means early detail is likely summarized even when occupancy looks low —
  // bottom-tier sessions escalate to "留意" instead of "放心继续". The proxy
  // scales with the window (A4): max(messageCountProxy, ratio × window) — 800
  // messages means little on a 1M window.
  const turns = countOrZero(state.turns)
  const userMessages = countOrZero(state.userMessages)
  const assistantMessages = countOrZero(state.assistantMessages)
  const compactions = countOrZero(state.compactions)
  const messages = userMessages + assistantMessages
  const effectiveProxy = window !== null && window > 0
    ? Math.max(t.messageCountProxy, Math.round(window * t.messageCountWindowRatio))
    : t.messageCountProxy
  const proxyHit = messages >= effectiveProxy
  if (severity === 'green' && proxyHit) severity = 'blue'

  // 窗口占用显示截断在 100%（ratio 可因口径差 >1，但「已占窗口 %」物理
  // 上限满窗——与 client 的 badge min(100) 一致）。
  const pct = ratio !== null ? Math.min(Math.round(ratio * 100), 100) : null
  // Compression ratio annotation (snapshot-delta caliber — see foldCompression).
  // Non-finite / out-of-range legacy values read as null (inconclusive), the
  // same surface an inconclusive fold produces.
  const rawRatio = state.compressionRatio
  const compressionRatio = typeof rawRatio === 'number' && Number.isFinite(rawRatio) && rawRatio >= 0 && rawRatio <= 1
    ? rawRatio
    : null
  const ratioNote = compressionRatio !== null
    ? `；上次压缩比例 ≈ ${Math.round(compressionRatio * 100)}%，快照口径`
    : ''
  const compacted = (() => {
    if (!(compactions > 0)) return ``
    const freqNote = compactIntervalRounds(turns, compactions)
    return `（已压缩 ${compactions} 次${freqNote !== null ? `，约每 ${freqNote} 轮一次` : ''}${ratioNote}）`
  })()

  let advice: string
  switch (severity) {
    case 'red':
      advice = `上下文已占窗口 ${pct}%${compacted}，建议尽快在任务边界收尾并交接。`
      break
    case 'yellow':
      advice = capacityHigh
        ? `上下文已占窗口 ${pct}%${compacted}，建议在任务边界收尾；若剩余工作还多，开新会话更划算。`
        : `每轮计费约 ${formatCompact(effectivePerRound ?? 0)} token（已计缓存折扣），费用可观；若剩余工作还多，开新会话更划算。${compacted}`
      break
    case 'blue':
      // The compaction annotation rides every tier (blue/green appended):
      // how much the last fold compressed is useful context at any severity.
      // proxyHit can promote to blue with ratio === null (no pressure sample
      // or window unknown) — render the message-count reason then, never a
      // literal "null%" (AUDIT R1-2).
      advice = (proxyHit && (ratio === null || ratio < t.windowMid)
        ? `消息量已达 ${messages} 条（代理指标），早期内容可能被压缩——继续但留意，必要时开新会话。`
        : `上下文占用 ${pct}%（中等），继续但留意窗口压力。`) + compacted
      break
    default:
      advice = (ratio !== null ? `空间充足（占用 ${pct}%），放心继续。` : '各项信号正常，放心继续。') + compacted
  }

  return {
    severity,
    advice,
    ratio,
    total,
    window,
    turns,
    userMessages,
    assistantMessages,
    compactions,
    compressionRatio,
    uncachedInputTokens,
    cacheReadTokens,
    // R1 sparkline: coerce at the wire boundary (S2 discipline) — drop
    // non-finite / negative legacy samples, keep insertion order.
    pressureHistory: (state.pressureHistory ?? []).filter(s => finiteNonNeg(s) !== null),
    effectivePerRound,
    effectivePerRoundUsd,
    effectivePerRoundCny,
    pricePeriod,
  }
}

/** Build the unit for one registration; the fold functions close over config. */
export function sessionHealthProjectionDefinition(
  config: ConfigSource,
  pricing?: { get(model?: string): ResolvedPricing },
  modelOf?: () => string,
): ProjectionDefinition<'sessionHealth', SessionHealthState> {
  // 0.1.1+ wire 契约（破坏性变化，见 ROADMAP「升级体检基线」）：snapshot /
  // cachedSnapshot / coldSnapshot 的 values 只收集 client-visible（带 wire）
  // 的 unit；不带 wire 的 unit 是 host-only，其值从所有快照省略（health 全
  // null = 「没有基础数据」）。sessionHealth 不在 harness 核心
  // SessionProjectionMap（TS 上 wire 类型为 never），但运行时 register 只看
  // def.wire 是否存在——补上即进入所有快照。viewSchema 复用 wire payload
  // schema；view 与旧 view 同源（healthView）——payload 形状不变，stateVersion
  // 无需 bump。
  const wireView = (state: SessionHealthState) => healthView(state, readConfig(config), pricing?.get(modelOf?.() ?? ''))
  // sessionHealth 不在 harness 核心 SessionProjectionMap → TS 上 wire 为 never，
  // 需整体断言（运行时 register 只看 def.wire 是否存在，与类型无关）。
  // 双契约兼容（S2）：0.1.1+ register 只擦除式保留 wire（wire.view 归一化为
  // 读侧）；rc.6 直接用顶层 def.view + def.schema。两代 harness 各取所需，
  // 顶层 view 在 0.1.1 上被擦除、无副作用。
  const unit = {
    key: 'sessionHealth',
    schema: sessionHealthProjectionSchema,
    init,
    apply: applyHealthEvent,
    view: wireView,
    wire: {
      viewSchema: sessionHealthProjectionSchema,
      view: wireView,
    },
    // v7: cache-hit rate removed from this unit — it now reads the core
    // tokenUsage projection via src/usage.ts (single data source, single
    // algorithm location shared with the input-bar stats line).
    // v8: compression-ratio inference added (preCompactionPressure +
    // compressionRatio fold fields, wire field compressionRatio).
    // v9 (R1): pressureHistory ring added to the fold — old persisted rows
    // are discarded and the full log replay rebuilds the history (the S2
    // suite asserts the discard + schema-valid-view contract).
    // v10 (AUDIT R1-1): lastSample (turn, step) dedup key + capture-failure
    // ratio invalidation change fold semantics — old rows discarded, replay
    // rebuilds both history and dedup state.
    stateVersion: 10,
  }
  return unit as unknown as ProjectionDefinition<'sessionHealth', SessionHealthState>
}
