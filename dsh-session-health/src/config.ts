/**
 * dsh-session-health — plugin configuration.
 *
 * Every threshold mirrors the community session-health skill's
 * two-dimensional continue-vs-new decision model, but as host-side defaults a
 * deployment can override. The exported schemastery `Config` documents the
 * shape for the Loader / settings UI; resolveConfig() defensively defaults so
 * partial configs (and tests) always yield a complete ResolvedConfig.
 */
import z from '@deepseek-ai/schemastery'

export interface ThresholdsConfig {
  /** Window-ratio floor of the "留意" (blue) tier. Default 0.3. */
  windowMid: number
  /** Window-ratio floor of the "留意/收尾" (yellow) tier. Default 0.5. */
  windowHigh: number
  /** Window-ratio floor of the "危险区" (red) tier. Default 0.8. */
  windowCritical: number
  /** Per-round input tokens that make the economy dimension expensive. Default 50000. */
  economyTokenFloor: number
  /** Remaining rounds at which economy cost accumulates. Default 10. */
  economyRoundFloor: number
  /** Message-count proxy for context bloat. Default 800. */
  messageCountProxy: number
}

export interface ChecksConfig {
  git: { enabled: boolean; workspaceRoot?: string }
  handoff: { enabled: boolean; paths: string[] }
  sessionResume: { enabled: boolean }
  processes: { enabled: boolean }
}

export interface ProjectionConfig {
  /** Fold the sessionHealth projection unit (badge becomes reactive, no polling). Default true. */
  enabled: boolean
}

export interface CostConfig {
  /**
   * Cache-hit token price as a fraction of a full-price input token (e.g.
   * DeepSeek-style 0.1 = 1/10). Used for the per-round billable-equivalent
   * figure ("计费预期") in the projection, /health, and the tool. Default 0.1.
   */
  cacheHitDiscount: number
}

/** Untrusted plugin configuration after Loader normalization; every field optional. */
export interface Config {
  thresholds?: ThresholdsConfig
  checks?: ChecksConfig
  projection?: ProjectionConfig
  cost?: CostConfig
}

/** Schemastery schema: documents the shape for the Loader and settings UI. */
export const Config: z<Config> = z.object({
  thresholds: z.object({
    windowMid: z.number().min(0).max(1).default(0.3),
    windowHigh: z.number().min(0).max(1).default(0.5),
    windowCritical: z.number().min(0).max(1).default(0.8),
    economyTokenFloor: z.number().min(0).default(50000),
    economyRoundFloor: z.number().min(0).default(10),
    messageCountProxy: z.number().min(0).default(800),
  }),
  checks: z.object({
    git: z.object({
      enabled: z.boolean().default(true),
      workspaceRoot: z.string(),
    }),
    handoff: z.object({
      enabled: z.boolean().default(true),
      /** User-named handoff documents; the concept is yours, the names are yours. */
      paths: z.array(z.string()).default([]),
    }),
    sessionResume: z.object({ enabled: z.boolean().default(true) }),
    processes: z.object({ enabled: z.boolean().default(true) }),
  }),
  projection: z.object({ enabled: z.boolean().default(true) }),
  cost: z.object({ cacheHitDiscount: z.number().min(0).max(1).default(0.1) }),
})

export interface ResolvedConfig {
  thresholds: ThresholdsConfig
  checks: ChecksConfig
  projection: ProjectionConfig
  cost: CostConfig
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const thresholds: ThresholdsConfig = {
    windowMid: config.thresholds?.windowMid ?? 0.3,
    windowHigh: config.thresholds?.windowHigh ?? 0.5,
    windowCritical: config.thresholds?.windowCritical ?? 0.8,
    economyTokenFloor: config.thresholds?.economyTokenFloor ?? 50000,
    economyRoundFloor: config.thresholds?.economyRoundFloor ?? 10,
    messageCountProxy: config.thresholds?.messageCountProxy ?? 800,
  }
  const checks: ChecksConfig = {
    git: {
      enabled: config.checks?.git?.enabled ?? true,
      workspaceRoot: config.checks?.git?.workspaceRoot,
    },
    handoff: {
      enabled: config.checks?.handoff?.enabled ?? true,
      paths: config.checks?.handoff?.paths ?? [],
    },
    sessionResume: { enabled: config.checks?.sessionResume?.enabled ?? true },
    processes: { enabled: config.checks?.processes?.enabled ?? true },
  }
  const projection: ProjectionConfig = { enabled: config.projection?.enabled ?? true }
  const cost: CostConfig = { cacheHitDiscount: config.cost?.cacheHitDiscount ?? 0.1 }
  return { thresholds, checks, projection, cost }
}
