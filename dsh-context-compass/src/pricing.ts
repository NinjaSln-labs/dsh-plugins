/**
 * dsh-context-compass — pricing resolution.
 *
 * Money display needs input prices. The harness carries none, so the plugin
 * resolves them through a live cache driven by the OFFICIAL DeepSeek pricing
 * document (the default `priceUrl` is the dsh-plugins repo's
 * `pricing/deepseek.json`, synced from api-docs.deepseek.com/quick_start/pricing):
 * - peak/off-peak periods are evaluated against BEIJING wall time on every
 *   read (DeepSeek peak hours 9–12 and 14–18 Beijing; everything else is
 *   off-peak at half price)
 * - per-model prices picked by the current model name (models["*"] fallback)
 * - the document is CNY-denominated; USD is derived through its `usdPerCny`
 *   rate, so the client can display either currency by locale
 * - `priceSource: 'static'` never fetches and resolves the config values
 *   (USD-denominated, flat) with no period
 *
 * The projection unit's view and assess() read the same cache through
 * `ctx.sessionHealthPricing` (the fold stays event-pure).
 */
import type { Context } from '@deepseek-ai/cordis'

export type PricePeriod = 'peak' | 'offpeak' | null

/**
 * One resolved price the money math runs on. Both official currencies ride
 * along (the zh docs publish CNY, the en docs USD — no conversion): static
 * mode carries USD only.
 */
export interface ResolvedPricing {
  /** Full-price (cache-miss) input price per 1M tokens, USD. */
  missPerMUsd: number
  /** Cache-hit input price per 1M tokens, USD. */
  hitPerMUsd: number
  /** Full-price (cache-miss) input price per 1M tokens, CNY; null in static mode. */
  missPerMCny: number | null
  /** Cache-hit input price per 1M tokens, CNY; null in static mode. */
  hitPerMCny: number | null
  /** Current period; null in static mode. */
  period: PricePeriod
}

interface PeriodPrice {
  inputMissPerMCny: number
  inputHitPerMCny: number
  inputMissPerMUsd: number
  inputHitPerMUsd: number
}

interface ModelPrice {
  peak: PeriodPrice
  offpeak: PeriodPrice
}

interface PricingDocument {
  source?: unknown
  updatedAt?: unknown
  note?: unknown
  peakHours: readonly (readonly [number, number])[]
  models: Readonly<Record<string, ModelPrice | undefined>>
}

function isPair(value: unknown): value is readonly [number, number] {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'number' && typeof value[1] === 'number'
    && value[0] >= 0 && value[1] > value[0] && value[1] <= 24
}

function isPeriodPrice(value: unknown): value is PeriodPrice {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  for (const key of ['inputMissPerMCny', 'inputHitPerMCny', 'inputMissPerMUsd', 'inputHitPerMUsd']) {
    const n = p[key]
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return false
  }
  if ((p.inputMissPerMCny as number) <= 0 || (p.inputMissPerMUsd as number) <= 0) return false
  return true
}

function isModelPrice(value: unknown): value is ModelPrice {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return isPeriodPrice(v.peak) && isPeriodPrice(v.offpeak)
}

function validDocument(value: unknown): PricingDocument | null {
  if (typeof value !== 'object' || value === null) return null
  const doc = value as Record<string, unknown>
  if (!Array.isArray(doc.peakHours) || doc.peakHours.length === 0 || !doc.peakHours.every(isPair)) return null
  if (typeof doc.models !== 'object' || doc.models === null) return null
  const models: Record<string, ModelPrice | undefined> = {}
  let found = false
  for (const [name, price] of Object.entries(doc.models as Record<string, unknown>)) {
    if (!isModelPrice(price)) return null
    models[name] = price
    found = true
  }
  if (!found) return null
  return {
    peakHours: doc.peakHours as readonly (readonly [number, number])[],
    models,
  }
}

/** Beijing wall-clock minutes from an epoch-millis instant (fixed UTC+8, DST-free). */
function beijingMinutes(nowMs: number): number {
  const bj = new Date(nowMs + 8 * 3_600_000)
  return bj.getUTCHours() * 60 + bj.getUTCMinutes()
}

/** DeepSeek peak/valley: peak when Beijing time falls inside a peak window. */
export function periodAt(peakHours: readonly (readonly [number, number])[], nowMs: number): 'peak' | 'offpeak' {
  const t = beijingMinutes(nowMs)
  for (const [start, end] of peakHours) {
    if (t >= start * 60 && t < end * 60) return 'peak'
  }
  return 'offpeak'
}

/** Static-mode resolved pricing (flat USD, no period, no CNY). */
export function staticPricing(inputPricePerM: number, cacheHitDiscount: number): ResolvedPricing {
  return {
    missPerMUsd: inputPricePerM,
    hitPerMUsd: inputPricePerM * cacheHitDiscount,
    missPerMCny: null,
    hitPerMCny: null,
    period: null,
  }
}

/** Live pricing cache: static values until a successful fetch replaces them. */
export class PriceCache {
  private doc: PricingDocument | null = null

  constructor(private readonly fallback: ResolvedPricing) {}

  /**
   * Current resolved pricing for one model (unknown models use the doc's
   * "*" entry; no doc or no matching entry → the static fallback). The
   * period is evaluated against the current Beijing time on every call.
   */
  get(model?: string): ResolvedPricing {
    if (this.doc === null) return this.fallback
    const entry = (model !== undefined && model !== '' ? this.doc.models[model] : undefined) ?? this.doc.models['*']
    if (entry === undefined) return this.fallback
    const period = periodAt(this.doc.peakHours, Date.now())
    const p = entry[period]
    return {
      missPerMUsd: p.inputMissPerMUsd,
      hitPerMUsd: p.inputHitPerMUsd,
      missPerMCny: p.inputMissPerMCny,
      hitPerMCny: p.inputHitPerMCny,
      period,
    }
  }

  /** One refresh attempt; false (and unchanged state) on any failure. */
  async refresh(
    url: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 10_000,
  ): Promise<boolean> {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
      if (!response.ok) return false
      const doc = validDocument(await response.json())
      if (doc === null) return false
      this.doc = doc
      return true
    } catch {
      return false
    }
  }

  /** Try the URLs in order; the first successful fetch wins. */
  async refreshAny(urls: readonly string[], fetchImpl: typeof fetch = fetch, timeoutMs = 10_000): Promise<boolean> {
    for (const url of urls) {
      if (await this.refresh(url, fetchImpl, timeoutMs)) return true
    }
    return false
  }
}

function intervalDisposer(ctx: Context, fn: () => void, delayMs: number): () => void {
  // cordis-plugin-timer when mounted; a raw interval otherwise (both cleaned
  // up through the effect, so the fiber never leaks the timer).
  const timer = ctx.get('timer') as { setInterval(fn: () => void, delay: number): () => void } | undefined
  if (timer !== undefined) {
    return timer.setInterval(fn, delayMs)
  }
  const id = setInterval(fn, delayMs)
  return () => clearInterval(id)
}

/**
 * Start the periodic price refresh: one immediate fire-and-forget fetch (with
 * the fallback URL in the same cycle), then `priceRefreshHours` cadence.
 * Failures are silent (the cache keeps the last good price / the static
 * fallback). Disposal rides the calling fiber.
 * @returns the disposer.
 */
export function startPricingRefresh(
  ctx: Context,
  config: { priceSource: 'auto' | 'static'; priceUrl: string; priceFallbackUrl: string; priceRefreshHours: number },
  cache: PriceCache,
): () => void {
  if (config.priceSource !== 'auto') return () => {}
  const urls = [...new Set([config.priceUrl, config.priceFallbackUrl].filter(Boolean))]
  const refresh = () => void cache.refreshAny(urls)
  refresh()
  return ctx.effect(() => intervalDisposer(ctx, refresh, config.priceRefreshHours * 3_600_000), 'dsh-context-compass: pricing refresh')
}
