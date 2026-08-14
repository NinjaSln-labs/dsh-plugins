/**
 * dsh-session-health — small shared helpers.
 */

/** Compact token formatting: 123456 -> 123K, 1234567 -> 1.2M, 10000000 -> 10M. */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + 'M'
  }
  if (n >= 1000) return Math.round(n / 1000) + 'K'
  return String(n)
}

/** Hit rate display: floored integer percent — 0.9993 -> '99%' (true lower bound, never a fake 100%). The raw 0..1 value stays in the data. */
export function formatHitRate(rate: number): string {
  return `${Math.floor(rate * 100)}%`
}

/** USD formatting for per-round cost: >= $100 rounded, else 2 decimals ($0.02, $1.25, $45.00 -> $45). */
export function formatUsd(v: number): string {
  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`
}
