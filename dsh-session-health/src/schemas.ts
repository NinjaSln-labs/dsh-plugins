/**
 * dsh-session-health — runtime schemas (host-only).
 *
 * The zod schema validates the projection value before every push; the
 * schemastery schemas back the typert Remote methods. Nothing in this module
 * is imported by the client bundle.
 */
import { z as zod } from 'zod'
import z from '@deepseek-ai/schemastery'
import type { HealthStateRequest, HealthStateResult, SessionHealthProjection } from './types.ts'

/** Wire schema for the projection value (validated before every push). */
export const sessionHealthProjectionSchema = zod.object({
  severity: zod.enum(['green', 'blue', 'yellow', 'red']),
  advice: zod.string(),
  ratio: zod.number().nullable(),
  total: zod.number().nullable(),
  window: zod.number().nullable(),
  turns: zod.number().int().nonnegative(),
  userMessages: zod.number().int().nonnegative(),
  assistantMessages: zod.number().int().nonnegative(),
  compactions: zod.number().int().nonnegative(),
}).strict() as unknown as zod.ZodType<SessionHealthProjection>

export const HealthStateRequestSchema = z.object({
  sessionId: z.string(),
}) as unknown as z<HealthStateRequest>

export const HealthStateResultSchema = z.object({
  color: z.union([z.const('green'), z.const('blue'), z.const('yellow'), z.const('red')]),
  ratio: z.union([z.number(), z.const(null)]),
  total: z.union([z.number(), z.const(null)]),
  window: z.union([z.number(), z.const(null)]),
}) as unknown as z<HealthStateResult>

/** Zod schemas for the Remote methods, consumed by typert generation. */
export const remoteSchemas = {
  healthState: { request: HealthStateRequestSchema, result: HealthStateResultSchema },
}
