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
import type { ResolvedConfig } from './config.ts'
import type { PricePeriod, ResolvedPricing } from './pricing.ts'
import { formatCompact } from './util.ts'

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
      return foldCompression(
        { ...next, pressureTokens: post, lastUsage: bucketsOf(u) },
        post,
      )
    }
    case 'assistant/chunk': {
      if (event.data.chunk.type !== 'usage') return state
      const u = event.data.chunk.usage
      if (typeof u.inputTokens !== 'number') return state
      const post = pressureOf(u)
      return foldCompression(
        { ...state, pressureTokens: post, lastUsage: bucketsOf(u) },
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
  const total = state.pressureTokens ?? null
  const window = state.contextWindow ?? null
  const ratio = total !== null && window !== null && window > 0 ? total / window : null
  const t = config.thresholds

  // Last-request buckets for the per-round money math. The cache-hit RATE is
  // deliberately NOT computed here: it lives in src/usage.ts and both the
  // badge and /compass read the core `tokenUsage` projection (the same value
  // the input-bar stats line shows) — one data source, one algorithm spot.
  const lastUsage = state.lastUsage
  const uncachedInputTokens = lastUsage?.inputTokens ?? null
  const cacheReadTokens = lastUsage?.cacheReadTokens ?? null
  // Money math: with an official pricing document the cache-hit ratio comes
  // from the official USD pair and each currency uses its own official miss
  // price (zh docs: CNY, en docs: USD — no conversion); static mode uses the
  // config's flat USD values.
  const missPerMUsd = price !== undefined ? price.missPerMUsd : config.cost.inputPricePerM
  const hitPerMUsd = price !== undefined ? price.hitPerMUsd : missPerMUsd * config.cost.cacheHitDiscount
  const discount = missPerMUsd > 0 ? hitPerMUsd / missPerMUsd : config.cost.cacheHitDiscount
  const effectivePerRound = lastUsage !== undefined
    ? lastUsage.inputTokens + lastUsage.cacheReadTokens * discount
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
  const messages = state.userMessages + state.assistantMessages
  const effectiveProxy = window !== null && window > 0
    ? Math.max(t.messageCountProxy, Math.round(window * t.messageCountWindowRatio))
    : t.messageCountProxy
  const proxyHit = messages >= effectiveProxy
  if (severity === 'green' && proxyHit) severity = 'blue'

  const pct = ratio !== null ? Math.round(ratio * 100) : null
  // Compression ratio annotation (snapshot-delta caliber — see foldCompression).
  const compressionRatio = state.compressionRatio ?? null
  const ratioNote = compressionRatio !== null
    ? `；上次压缩比例 ≈ ${Math.round(compressionRatio * 100)}%，快照口径`
    : ''
  const compacted = state.compactions > 0 ? `（已压缩 ${state.compactions} 次${ratioNote}）` : ''

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
      advice = (proxyHit && ratio !== null && ratio < t.windowMid
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
    turns: state.turns,
    userMessages: state.userMessages,
    assistantMessages: state.assistantMessages,
    compactions: state.compactions,
    compressionRatio,
    uncachedInputTokens,
    cacheReadTokens,
    effectivePerRound,
    effectivePerRoundUsd,
    effectivePerRoundCny,
    pricePeriod,
  }
}

/** Build the unit for one registration; the fold functions close over config. */
export function sessionHealthProjectionDefinition(
  config: ResolvedConfig,
  pricing?: { get(model?: string): ResolvedPricing },
  modelOf?: () => string,
): ProjectionDefinition<'sessionHealth', SessionHealthState> {
  return {
    key: 'sessionHealth',
    schema: sessionHealthProjectionSchema,
    init,
    apply: applyHealthEvent,
    // The fold stays event-pure; only the money view reads the live price
    // cache (falls back to the static config when no cache is mounted).
    view: state => healthView(state, config, pricing?.get(modelOf?.() ?? '')),
    // v7: cache-hit rate removed from this unit — it now reads the core
    // tokenUsage projection via src/usage.ts (single data source, single
    // algorithm location shared with the input-bar stats line).
    // v8: compression-ratio inference added (preCompactionPressure +
    // compressionRatio fold fields, wire field compressionRatio).
    stateVersion: 8,
  }
}
