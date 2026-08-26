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
 *  *** 单一权威（C1）***：此 schema 的 .default() 是配置默认值的唯一来源——
 *  settings 服务路径由它归一化；resolveConfig 的 ?? 回退仅服务无 settings
 *  回退与测试路径，改默认值时两处仍需同步。 */
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

/**
 * C1 live config source: a resolved snapshot (mount-time closure, the old
 * shape — tests and the no-settings fallback) or a thunk reading the current
 * authoritative value (the installSettingsSection wiring). Consumers read
 * through readConfig() at USE time, so a thunk makes threshold changes live.
 */
export type ConfigSource = ResolvedConfig | (() => ResolvedConfig)

/** Read one ConfigSource at use time. */
export function readConfig(source: ConfigSource): ResolvedConfig {
  return typeof source === 'function' ? source() : source
}

/**
 * C1 cross-field validate (settings hooks.validate): the three capacity tiers
 * must ascend — a schema cannot express the relation, and a non-monotonic
 * ladder would make severity ordering silently wrong. Throwing refuses the
 * write that produced the value (settings-service semantics), so the caller
 * learns at update time instead of storing a broken ladder.
 */
export function validateThresholdLadder(value: ResolvedConfig): void {
  const t = value.thresholds
  if (!(t.windowMid < t.windowHigh && t.windowHigh < t.windowCritical)) {
    throw new Error(
      `阈值必须单调递增：windowMid(${t.windowMid}) < windowHigh(${t.windowHigh}) < windowCritical(${t.windowCritical})`,
    )
  }
}

/**
 * C1 hooks.validate — full-config cross-field + finiteness check (AUDIT C1-3).
 * Schemastery's range check is NaN-blind (`NaN > max` is false), so a
 * hand-edited YAML (`.nan`/`.inf`, which bypasses the settings-write JSON
 * shape check) could silently distort the economy/cost verdicts. Every numeric
 * config field must be finite; ladder monotonicity rides on top.
 */
export function validateConfig(value: ResolvedConfig): void {
  validateThresholdLadder(value)
  const numeric: Array<[string, number]> = [
    ['thresholds.windowMid', value.thresholds.windowMid],
    ['thresholds.windowHigh', value.thresholds.windowHigh],
    ['thresholds.windowCritical', value.thresholds.windowCritical],
    ['thresholds.economyTokenFloor', value.thresholds.economyTokenFloor],
    ['thresholds.economyWindowRatio', value.thresholds.economyWindowRatio],
    ['thresholds.economyRoundFloor', value.thresholds.economyRoundFloor],
    ['thresholds.messageCountProxy', value.thresholds.messageCountProxy],
    ['thresholds.messageCountWindowRatio', value.thresholds.messageCountWindowRatio],
    ['cost.cacheHitDiscount', value.cost.cacheHitDiscount],
    ['cost.inputPricePerM', value.cost.inputPricePerM],
    ['cost.priceRefreshHours', value.cost.priceRefreshHours],
  ]
  for (const [path, n] of numeric) {
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`配置 ${path} 必须是非负有限数，收到 ${String(n)}`)
    }
  }
}

/** 双源警告（C1 后语义）：live 路径的默认值由 Config schema（settings 服务）
 *  归一化——schema 是唯一权威；此函数仅服务「无 settings 服务的回退」与
 *  纯函数测试路径，其 `??` 回退必须与 schema .default() 保持同步。 */
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
