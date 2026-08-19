/**
 * dsh-context-compass — plugin configuration.
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
  /**
   * Billable-equivalent (cache-discounted) tokens per round that make the
   * economy dimension expensive. Default 50000. The effective floor is
   * max(economyTokenFloor, economyWindowRatio × contextWindow) when the
   * window is known — the absolute default was calibrated for ~128K-window
   * models, so it must scale up on larger windows or every session crosses
   * it at single-digit occupancy.
   */
  economyTokenFloor: number
  /**
   * Window-ratio component of the economy floor (see economyTokenFloor).
   * Default 0.3: on a 1M-window model the economy tier needs ~300K
   * billable-equivalent per round before it outranks the ratio tiers.
   */
  economyWindowRatio: number
  /** Remaining rounds at which economy cost accumulates. Default 10. */
  economyRoundFloor: number
  /** Message-count proxy for context bloat. Default 800. */
  messageCountProxy: number
  /**
   * Window-ratio component of the message-count proxy (A4): the effective
   * proxy is max(messageCountProxy, messageCountWindowRatio × contextWindow)
   * — 800 messages on a 128K window is not the same as on a 1M window.
   * Default 0.002: 128K → max(800, 256)=800, 1M → max(800, 2000)=2000.
   */
  messageCountWindowRatio: number
}

export interface ChecksConfig {
  git: { enabled: boolean; workspaceRoot?: string }
  handoff: { enabled: boolean; paths: string[] }
  sessionResume: { enabled: boolean }
  processes: { enabled: boolean }
  /** 知识库联动（解耦版）：探测 ctx.get('knowledge') 做跨会话回顾；未装则跳过。默认 true。 */
  knowledge: { enabled: boolean }
}

export interface ProjectionConfig {
  /** Fold the sessionHealth projection unit (badge becomes reactive, no polling). Default true. */
  enabled: boolean
}

export interface CostConfig {
  /**
   * Cache-hit token price as a fraction of a full-price input token (e.g.
   * DeepSeek-style 0.1 = 1/10). Used for the per-round billable-equivalent
   * figure ("计费预期") in the projection, /compass, and the tool. Default 0.1.
   */
  cacheHitDiscount: number
  /**
   * Full-price input price in USD per 1M tokens (cache hits bill at
   * cacheHitDiscount × this). Static fallback AND the value used when
   * priceSource is 'static'. Default 0.28 (DeepSeek-class pricing).
   */
  inputPricePerM: number
  /**
   * 'auto' (default): periodically fetch the price from priceUrl and use the
   * last good document (falling back to the static values on failure).
   * 'static': never fetch; use inputPricePerM / cacheHitDiscount directly.
   */
  priceSource: 'auto' | 'static'
  /**
   * Primary JSON pricing document URL for priceSource 'auto'. Default: the
   * jsdelivr CDN mirror of the dsh-plugins repo's pricing/deepseek.json —
   * GitHub raw is unreachable on many CN networks and a failed fetch silently
   * degrades the whole money display to static USD (no CNY).
   */
  priceUrl: string
  /**
   * Fallback URL tried in the same refresh cycle when the primary fails.
   * Default: the canonical GitHub raw location (covers CDN outages / stale
   * mirrors; whichever URL succeeds first wins).
   */
  priceFallbackUrl: string
  /** Refresh cadence for priceSource 'auto', in hours. Default 24. */
  priceRefreshHours: number
}

/** Untrusted plugin configuration after Loader normalization; every field optional. */
export interface Config {
  thresholds?: ThresholdsConfig
  checks?: ChecksConfig
  projection?: ProjectionConfig
  cost?: CostConfig
}

/** Schemastery schema: documents the shape for the Loader and settings UI.
 *  *** 双源警告 ***：此 schema 的 .default() 值与下方 resolveConfig 的 ?? 回退
 *  必须保持同步——Loader 路径走 schema 归一化，直接调用路径走 resolveConfig；
 *  改一处必须改另一处。 */
export const Config: z<Config> = z.object({
  thresholds: z.object({
    windowMid: z.number().min(0).max(1).default(0.3),
    windowHigh: z.number().min(0).max(1).default(0.5),
    windowCritical: z.number().min(0).max(1).default(0.8),
    economyTokenFloor: z.number().min(0).default(50000),
    economyWindowRatio: z.number().min(0).max(1).default(0.3),
    economyRoundFloor: z.number().min(0).default(10),
    messageCountProxy: z.number().min(0).default(800),
    messageCountWindowRatio: z.number().min(0).max(1).default(0.002),
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
    /** 运行中进程检测（dev server 等）是增量信号——默认关闭（对齐 DESIGN §4.6「关闭时跳过」）；/compass processes 或工具路径显式开启。 */
    processes: z.object({ enabled: z.boolean().default(false) }),
    knowledge: z.object({ enabled: z.boolean().default(true) }),
  }),
  projection: z.object({ enabled: z.boolean().default(true) }),
  cost: z.object({
    cacheHitDiscount: z.number().min(0).max(1).default(0.1),
    inputPricePerM: z.number().min(0).default(0.28),
    priceSource: z.union([z.const('auto'), z.const('static')]).default('auto'),
    priceUrl: z.string().default('https://cdn.jsdelivr.net/gh/NinjaSln-labs/dsh-plugins@main/pricing/deepseek.json'),
    priceFallbackUrl: z.string().default('https://raw.githubusercontent.com/NinjaSln-labs/dsh-plugins/main/pricing/deepseek.json'),
    priceRefreshHours: z.number().min(1).max(24 * 30).default(24),
  }),
})

export interface ResolvedConfig {
  thresholds: ThresholdsConfig
  checks: ChecksConfig
  projection: ProjectionConfig
  cost: CostConfig
}

/** 双源警告：此函数手动维护与上方 Config schema .default() 完全相同的默认值。
 *  Loader 路径走 schema 归一化，直接调用路径（测试/内部）走此处回退；
 *  改一处必须改另一处。 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const thresholds: ThresholdsConfig = {
    windowMid: config.thresholds?.windowMid ?? 0.3,
    windowHigh: config.thresholds?.windowHigh ?? 0.5,
    windowCritical: config.thresholds?.windowCritical ?? 0.8,
    economyTokenFloor: config.thresholds?.economyTokenFloor ?? 50000,
    economyWindowRatio: config.thresholds?.economyWindowRatio ?? 0.3,
    economyRoundFloor: config.thresholds?.economyRoundFloor ?? 10,
    messageCountProxy: config.thresholds?.messageCountProxy ?? 800,
    messageCountWindowRatio: config.thresholds?.messageCountWindowRatio ?? 0.002,
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
    processes: { enabled: config.checks?.processes?.enabled ?? false },
    knowledge: { enabled: config.checks?.knowledge?.enabled ?? true },
  }
  const projection: ProjectionConfig = { enabled: config.projection?.enabled ?? true }
  const cost: CostConfig = {
    cacheHitDiscount: config.cost?.cacheHitDiscount ?? 0.1,
    inputPricePerM: config.cost?.inputPricePerM ?? 0.28,
    priceSource: config.cost?.priceSource ?? 'auto',
    priceUrl: config.cost?.priceUrl ?? 'https://cdn.jsdelivr.net/gh/NinjaSln-labs/dsh-plugins@main/pricing/deepseek.json',
    priceFallbackUrl: config.cost?.priceFallbackUrl ?? 'https://raw.githubusercontent.com/NinjaSln-labs/dsh-plugins/main/pricing/deepseek.json',
    priceRefreshHours: config.cost?.priceRefreshHours ?? 24,
  }
  return { thresholds, checks, projection, cost }
}
