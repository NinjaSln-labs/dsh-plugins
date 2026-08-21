/**
 * dsh-subagent-router — plugin config schema.
 *
 * The exported schemastery `Config` documents the config shape for the
 * Loader and the settings UI (设置 → 插件配置). Every field is optional with
 * a sane default, matching `resolveConfig` in index.ts.
 *
 * *** 双源警告 ***：此 schema 的 `.default()` 值与 index.ts 中
 * `resolveConfig` 的 `??` 回退必须保持同步——Loader 路径走 schema 归一化，
 * 直接调用路径走 resolveConfig；改一处必须改另一处。
 */
import z from '@deepseek-ai/schemastery'

/** Per-tier auto selection mode. */
const autoTierPolicyMode = z.union([z.const('anchor'), z.const('cheapest'), z.const('strongest')])

/** Schemastery schema: documents the shape for the Loader and settings UI. */
export const Config = z.object({
  /** The `ctx.subagents` provider name to start runs on (default `spawn`). */
  subagentProvider: z.string().default('spawn'),
  /** Model-facing delegation tool name (default `subagent_model`). */
  toolName: z.string().default('subagent_model'),
  /** Model-facing catalog tool name (default `subagent_models`). */
  modelsToolName: z.string().default('subagent_models'),
  /** Expose `run_in_background` on the delegation tool (default true). */
  enableRunInBackground: z.boolean().default(true),
  /** Background policy (default `one-shot`); `continuable` needs the provider's `prepareContinuable`. */
  backgroundMode: z.union([z.const('one-shot'), z.const('continuable')]).default('one-shot'),
  /** Register the `subagent_models` catalog tool (default true). */
  enableModelList: z.boolean().default(true),
  /** Accept `model: "auto"` on the delegation tool (default true). */
  enableAuto: z.boolean().default(true),
  /** After a failed foreground run, retry once on the next auto tier (default true). */
  autoEscalate: z.boolean().default(true),
  /** Reroute to a healthy provider route when the auto-chosen route fails terminally (quota/auth) (default true). */
  autoReroute: z.boolean().default(true),
  /** Max escalation steps on the same provider after repeated transient failures (default 1). */
  autoEscalationTiers: z.number().min(0).default(1),
  /** Provider priority order for `model: "auto"` provider resolution (default: registry order). */
  autoProviderOrder: z.array(z.string()).default([]),
  /** Per-tier selection mode; omitted tiers fall back to the built-in heuristic. */
  autoTierPolicy: z.object({
    trivial: autoTierPolicyMode.required(false),
    standard: autoTierPolicyMode.required(false),
    complex: autoTierPolicyMode.required(false),
  }).required(false),
  /** Per-tier explicit candidate list, in priority order; fully overrides the tier policy for that tier. */
  autoTierPicks: z.object({
    trivial: z.array(z.string()).required(false),
    standard: z.array(z.string()).required(false),
    complex: z.array(z.string()).required(false),
  }).required(false),
  /** Hard ceiling: `model: "auto"` never picks a model stronger than this id (budget cap). */
  autoCeiling: z.string().required(false),
  /** Child depth cap (default 3; `'provider-managed'` sends no cap). */
  maxDepth: z.union([z.number().min(0), z.const('provider-managed')]).default(3),
})
