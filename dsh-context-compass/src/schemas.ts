/**
 * dsh-context-compass — runtime schemas (host-only).
 *
 * The zod schema validates the projection value before every push. Nothing in
 * this module is imported by the client bundle.
 *
 * NOTE: no Typert Remote here. Community plugins cannot expose a Remote to
 * the browser client — the client mounts a fixed, build-time generated list
 * of remotes (api-remotes), so an injected `remote.sessionHealth` would stay
 * pending forever. The projection seam is the plugin's client data path.
 */
import { z as zod } from 'zod'
import type { SessionHealthProjection } from './types.ts'

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
  compressionRatio: zod.number().min(0).max(1).nullable(),
  uncachedInputTokens: zod.number().int().nonnegative().nullable(),
  cacheReadTokens: zod.number().int().nonnegative().nullable(),
  /** R1 sparkline: recent pressure samples (raw token totals), oldest first. */
  pressureHistory: zod.array(zod.number()),
  effectivePerRound: zod.number().nonnegative().nullable(),
  effectivePerRoundUsd: zod.number().nonnegative().nullable(),
  effectivePerRoundCny: zod.number().nonnegative().nullable(),
  pricePeriod: zod.enum(['peak', 'offpeak']).nullable(),
}).strict() as unknown as zod.ZodType<SessionHealthProjection>

/**
 * 0.1.1-rc.2 契约：ProjectionDefinition.stateSchema 验证持久化的 fold state
 * （SessionHealthState），是「能否安全复用 checkpoint」的守卫——ver 匹配且
 * parse 通过才复用，否则从 init 全量重放（安全）。形状验证（非数值苛求）：
 * 数值合法性由 healthView 防御（S2 矩阵），stateSchema 只判形状，避免合法
 * 但数值边缘的 state 被误拒而退化到每次全量重放。`.strict()` 拒绝未知字段
 * （未来新增字段的行 → 重放，与 stateVersion 语义一致）。
 */
export const sessionHealthStateSchema = zod.object({
  turns: zod.number(),
  lastTurn: zod.number().nullable(),
  userMessages: zod.number(),
  assistantMessages: zod.number(),
  compactions: zod.number(),
  pressureTokens: zod.number().optional(),
  contextWindow: zod.number().optional(),
  pressureHistory: zod.array(zod.number()).optional(),
  lastSample: zod.object({ turn: zod.number(), step: zod.number() }).optional(),
  preCompactionPressure: zod.number().optional(),
  compressionRatio: zod.number().nullable().optional(),
  lastUsage: zod.object({
    inputTokens: zod.number(),
    cacheReadTokens: zod.number(),
    cacheWriteTokens: zod.number(),
  }).optional(),
}).strict()
