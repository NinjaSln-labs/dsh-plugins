import z from '@deepseek-ai/schemastery'

/** Request: which session's health to compute. */
export const HealthStateRequest = z.object({
  sessionId: z.string(),
})

export type HealthStateRequest = z.infer<typeof HealthStateRequest>

/** Response: computed health snapshot for the badge. */
export const HealthStateResult = z.object({
  /** green | yellow | red — window ratio thresholds 0.5 / 0.8. */
  color: z.union([z.const('green'), z.const('yellow'), z.const('red')]),
  /** totalTokens / contextWindow, null when either is unavailable. */
  ratio: z.union([z.number(), z.const(null)]),
  /** Current request-and-response pressure (per-round input estimate). */
  total: z.union([z.number(), z.const(null)]),
  /** Model context window in tokens. */
  window: z.union([z.number(), z.const(null)]),
})

export type HealthStateResult = z.infer<typeof HealthStateResult>

/** Zod schemas for the Remote methods, consumed by typert generation. */
export const remoteSchemas = {
  healthState: { request: HealthStateRequest, result: HealthStateResult },
}
