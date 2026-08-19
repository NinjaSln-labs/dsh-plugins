/**
 * dsh-context-compass — small shared helpers.
 *
 * 纵深防御：所有格式化函数对非有限数（NaN/Infinity）返回 '—'——输入侧已有
 * 多层守卫（measureTokens/resolveWindow/remainingRounds 归一化），此处是
 * 最后防线，防任何遗漏路径把 $NaN/¥NaN/NaN% 泄漏进展示。
 */

/** Compact token formatting: 123456 -> 123K, 1234567 -> 1.2M, 10000000 -> 10M. */
export function formatCompact(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + 'M'
  }
  if (n >= 1000) {
    // Round-overflow guard: 999999 rounds to 1000K — carry it to 1M instead.
    const k = Math.round(n / 1000)
    if (k >= 1000) return Math.round(k / 100) / 10 + 'M'
    return k + 'K'
  }
  return String(n)
}

/** Hit rate display: integer percent, Math.round — matches the core input-bar stats line. */
export function formatHitRate(rate: number): string {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 100)}%`
}

/** USD formatting for per-round cost: >= $100 rounded, else 2 decimals ($0.02, $1.25, $45.00 -> $45). */
export function formatUsd(v: number): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`
}

/** CNY formatting: ¥0.15 (2 decimals, money convention). */
export function formatCny(v: number): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  return `¥${v.toFixed(2)}`
}

/** Peak/valley period labels used by the money notes. */
export const PERIOD_LABEL: Record<'peak' | 'offpeak', string> = { peak: '忙时', offpeak: '闲时' }
