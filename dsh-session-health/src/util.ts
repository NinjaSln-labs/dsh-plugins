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

/** Hit rate as an integer percent: 0.9993 -> '≈100%', 0.9 -> '90%' (no decimals, never a fake exact 100%). */
export function formatHitRate(rate: number): string {
  const pct = Math.round(rate * 100)
  return rate < 1 && pct === 100 ? '≈100%' : `${pct}%`
}
