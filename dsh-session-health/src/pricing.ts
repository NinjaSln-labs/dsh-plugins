/**
 * dsh-session-health — pricing resolution.
 *
 * Money display needs an input price. The harness carries no pricing, so the
 * plugin resolves it through a small live cache:
 * - `priceSource: 'auto'` (default) — periodically fetches a JSON pricing
 *   document from `cost.priceUrl` (default: the dsh-plugins repo's
 *   `pricing/deepseek.json`), falls back to the static config values on any
 *   failure, and keeps the last good price across refresh failures.
 * - `priceSource: 'static'` — never fetches; uses `cost.inputPricePerM` /
 *   `cost.cacheHitDiscount` directly.
 *
 * Expected JSON shape (currency must be "usd", the only supported one):
 *   { "currency": "usd", "inputPerM": 0.28, "cacheHitDiscount": 0.1 }
 *
 * The projection unit's view closes over a PriceCache getter (the fold stays
 * event-pure; only the config-like dependency reads live), and assess()
 * reads the same cache through `ctx.sessionHealthPricing`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedConfig } from './config.ts'

export interface ResolvedPricing {
  /** Full-price input tokens, USD per 1M. */
  inputPricePerM: number
  /** Cache-hit price as a fraction of the full price. */
  cacheHitDiscount: number
}

interface PricingDocument {
  currency?: unknown
  inputPerM?: unknown
  cacheHitDiscount?: unknown
}

function validDocument(value: unknown): PricingDocument | null {
  if (typeof value !== 'object' || value === null) return null
  const doc = value as PricingDocument
  if (doc.currency !== undefined && doc.currency !== 'usd') return null
  if (typeof doc.inputPerM !== 'number' || !Number.isFinite(doc.inputPerM) || doc.inputPerM < 0) return null
  if (doc.cacheHitDiscount !== undefined
    && (typeof doc.cacheHitDiscount !== 'number' || !Number.isFinite(doc.cacheHitDiscount)
      || doc.cacheHitDiscount < 0 || doc.cacheHitDiscount > 1)) return null
  return doc
}

/** Live pricing cache: static values until a successful fetch replaces them. */
export class PriceCache {
  private current: ResolvedPricing

  constructor(private readonly fallback: ResolvedPricing) {
    this.current = { ...fallback }
  }

  /** Current resolved pricing (never throws; starts at the static fallback). */
  get(): ResolvedPricing {
    return this.current
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
      this.current = {
        inputPricePerM: doc.inputPerM as number,
        cacheHitDiscount: doc.cacheHitDiscount as number | undefined ?? this.fallback.cacheHitDiscount,
      }
      return true
    } catch {
      return false
    }
  }
}

function intervalDisposer(ctx: Context, fn: () => void, delayMs: number): () => void {
  // cordis-plugin-timer when mounted; a raw interval otherwise (both cleaned
  // up through the effect, so the fiber never leaks the timer).
  const timer = ctx.get('timer') as { setInterval(fn: () => void, delay: number): () => void } | undefined
  if (timer !== undefined) {
    const dispose = timer.setInterval(fn, delayMs)
    return dispose
  }
  const id = setInterval(fn, delayMs)
  return () => clearInterval(id)
}

/**
 * Start the periodic price refresh: one immediate fire-and-forget fetch, then
 * `priceRefreshHours` cadence. Failures are silent (the cache keeps the last
 * good price / the static fallback). Disposal rides the calling fiber.
 * @returns the disposer.
 */
export function startPricingRefresh(ctx: Context, config: ResolvedConfig, cache: PriceCache): () => void {
  if (config.cost.priceSource !== 'auto') return () => {}
  const url = config.cost.priceUrl
  void cache.refresh(url)
  return ctx.effect(() => intervalDisposer(ctx, () => void cache.refresh(url), config.cost.priceRefreshHours * 3_600_000), 'dsh-session-health: pricing refresh')
}
