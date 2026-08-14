/**
 * dsh-session-health — the sessionHealth projection unit.
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
import type { ResolvedPricing } from './pricing.ts'
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
  /** Buckets of the most recent usage report (cache-hit accounting). */
  lastUsage?: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }
}

function init(): SessionHealthState {
  return { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
}

/** Prompt-side pressure of one usage report: input plus cache traffic, no output. */
function pressureOf(usage: { inputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/** The last-wins bucket record of one usage report. */
function bucketsOf(usage: { inputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }): SessionHealthState['lastUsage'] {
  return {
    inputTokens: usage.inputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  }
}

/** Pure transition: previous state + one committed event → next state. */
export function applyHealthEvent(state: SessionHealthState, event: SessionEvent): SessionHealthState {
  // Compaction events are appended by the compaction plugin and are not part
  // of the dsh-session union, so they are matched by name (same approach as
  // token-meter's surface fold).
  if ((event as { type?: string }).type === 'compaction/end') {
    return { ...state, compactions: state.compactions + 1 }
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
      if (event.data.usage !== undefined) {
        return { ...next, pressureTokens: pressureOf(event.data.usage), lastUsage: bucketsOf(event.data.usage) }
      }
      return next
    }
    case 'assistant/chunk': {
      if (event.data.chunk.type !== 'usage') return state
      return { ...state, pressureTokens: pressureOf(event.data.chunk.usage), lastUsage: bucketsOf(event.data.chunk.usage) }
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
 * Priority mirrors the skill: economy (absolute per-round cost, paid every
 * round) outranks capacity (window ratio); the message-count proxy annotates
 * only at the bottom tier (green → blue). The exact threshold values live in
 * config, never here.
 */
export function healthView(state: SessionHealthState, config: ResolvedConfig): SessionHealthProjection {
  const total = state.pressureTokens ?? null
  const window = state.contextWindow ?? null
  const ratio = total !== null && window !== null && window > 0 ? total / window : null
  const t = config.thresholds

  const economy = total !== null && total >= t.economyTokenFloor
  let severity: HealthSeverity = 'green'
  if (ratio !== null && ratio >= t.windowCritical) severity = 'red'
  else if ((ratio !== null && ratio >= t.windowHigh) || economy) severity = 'yellow'
  else if (ratio !== null && ratio >= t.windowMid) severity = 'blue'

  // Message-count proxy (dimension-A annotation): a very long message history
  // means early detail is likely summarized even when occupancy looks low —
  // bottom-tier sessions escalate to "留意" instead of "放心继续".
  const messages = state.userMessages + state.assistantMessages
  const proxyHit = messages >= t.messageCountProxy
  if (severity === 'green' && proxyHit) severity = 'blue'

  const pct = ratio !== null ? Math.round(ratio * 100) : null
  const compacted = state.compactions > 0 ? `（已压缩 ${state.compactions} 次）` : ''

  // Cache-hit accounting of the last request (null before any usage report).
  const lastUsage = state.lastUsage
  const cacheHitRate = lastUsage !== undefined && lastUsage.inputTokens + lastUsage.cacheReadTokens > 0
    ? lastUsage.cacheReadTokens / (lastUsage.inputTokens + lastUsage.cacheReadTokens)
    : null
  const uncachedInputTokens = lastUsage?.inputTokens ?? null
  const cacheReadTokens = lastUsage?.cacheReadTokens ?? null
  const effectivePerRound = lastUsage !== undefined
    ? lastUsage.inputTokens + lastUsage.cacheReadTokens * config.cost.cacheHitDiscount
    : null
  const effectivePerRoundUsd = effectivePerRound !== null
    ? effectivePerRound * config.cost.inputPricePerM / 1_000_000
    : null

  let advice: string
  switch (severity) {
    case 'red':
      advice = `上下文已占窗口 ${pct}%${compacted}，建议尽快在任务边界收尾并交接。`
      break
    case 'yellow':
      advice = ratio !== null
        ? `上下文已占窗口 ${pct}%${compacted}，建议在任务边界收尾；若剩余工作还多，开新会话更划算。`
        : `每轮输入约 ${formatCompact(total ?? 0)} token，费用可观；若剩余工作还多，开新会话更划算。`
      break
    case 'blue':
      advice = proxyHit && ratio !== null && ratio < t.windowMid
        ? `消息量已达 ${messages} 条（代理指标），早期内容可能被压缩——继续但留意，必要时开新会话。`
        : `上下文占用 ${pct}%（中等），继续但留意窗口压力。`
      break
    default:
      advice = ratio !== null ? `空间充足（占用 ${pct}%），放心继续。` : '各项信号正常，放心继续。'
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
    cacheHitRate,
    uncachedInputTokens,
    cacheReadTokens,
    effectivePerRound,
    effectivePerRoundUsd,
  }
}

/** Build the unit for one registration; the fold functions close over config. */
export function sessionHealthProjectionDefinition(
  config: ResolvedConfig,
  pricing?: { get(): ResolvedPricing },
): ProjectionDefinition<'sessionHealth', SessionHealthState> {
  return {
    key: 'sessionHealth',
    schema: sessionHealthProjectionSchema,
    init,
    apply: applyHealthEvent,
    // The fold stays event-pure; only the money view reads the live price
    // cache (falls back to the static config when no cache is mounted).
    view: state => healthView(state, pricing === undefined
      ? config
      : { ...config, cost: { ...config.cost, ...pricing.get() } }),
    // v3: effectivePerRoundUsd money field (invalidates persisted rows).
    stateVersion: 3,
  }
}
