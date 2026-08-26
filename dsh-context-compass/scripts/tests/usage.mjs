/**
 * Smoke domain: usage (cacheHitRateOf — the single cache-hit-rate algorithm).
 * Check moved verbatim from the monolith (L270-279), where it sat between the
 * projection domain's "display pct" and "per-round cost math" checks; the
 * runner preserves that exact position.
 */
import assert from 'node:assert/strict'
import { cacheHitRateOf } from '../../lib/usage.js'
import { check } from './helpers.mjs'

export async function run() {
  await check('usage: cacheHitRateOf — single algorithm for every surface', () => {
    // Same formula as the core input-bar stats line (cacheRead / (uncached +
    // cacheRead + cacheWrite)), operating on the core tokenUsage totals.
    assert.ok(Math.abs(cacheHitRateOf({ uncachedInputTokens: 350_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 }) - 500_000 / 850_000) < 1e-9)
    // cacheWrite counts in the denominator, exactly like the core stats line.
    assert.ok(Math.abs(cacheHitRateOf({ uncachedInputTokens: 100_000, cacheReadTokens: 400_000, cacheWriteTokens: 200_000 }) - 400_000 / 700_000) < 1e-9)
    // Nothing billed → null; absent projection → null.
    assert.equal(cacheHitRateOf({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), null)
    assert.equal(cacheHitRateOf(undefined), null)
  })
}
