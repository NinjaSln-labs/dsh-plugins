/**
 * dsh-session-health — shared value vocabulary.
 *
 * PURE-TYPE OUTLET: zero runtime imports, so the client bundle can import
 * these types without dragging any schema library. Runtime schemas live in
 * ./schemas.ts (host-only).
 */

/** Severity tiers of the two-dimensional continue-vs-new model. */
export type HealthSeverity = 'green' | 'blue' | 'yellow' | 'red'

/** Verdict for the model-facing tool. */
export type HealthRecommendation = 'continue' | 'continue-with-note' | 'suggest-switch' | 'danger-zone'

/**
 * Whole value the sessionHealth projection unit pushes to clients.
 *
 * `total` is the last provider-reported prompt-side pressure (per-round input
 * estimate, snapshot caliber), `window` the newest known model capacity, and
 * `ratio` their quotient. The severity + advice are computed host-side from
 * the deployment's config thresholds, so the client never needs the config.
 */
export interface SessionHealthProjection {
  severity: HealthSeverity
  /** One-line host advice (config-threshold aware). */
  advice: string
  /** pressureTokens / contextWindow; null while either is unknown. */
  ratio: number | null
  /** Last provider-reported prompt-side pressure. */
  total: number | null
  /** Model context window in tokens. */
  window: number | null
  turns: number
  userMessages: number
  assistantMessages: number
  /** Number of compaction rounds (early detail summarized). */
  compactions: number
  /**
   * Cache-hit ratio of the LAST request: cacheRead / (uncached input +
   * cacheRead). A high ratio means most of the context is served from the
   * provider cache — cheap, and a sign of stable context; compactions reset
   * it. Null before any usage report.
   */
  cacheHitRate: number | null
  /** Last request's uncached input tokens. Null before any usage report. */
  uncachedInputTokens: number | null
  /** Last request's tokens served from the provider cache. Null before any usage report. */
  cacheReadTokens: number | null
  /**
   * Per-round billable-equivalent: uncached input + cacheRead ×
   * cost.cacheHitDiscount (host config). Null before any usage report.
   */
  effectivePerRound: number | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Continue-vs-new verdict + signals, folded from session events. */
    sessionHealth: SessionHealthProjection
  }
}
