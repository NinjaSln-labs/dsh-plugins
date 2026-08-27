/**
 * dsh-subagent-router — model selection scope (2a refinement).
 *
 * The live catalog can easily hold 150+ model ids (bailian alone advertises
 * ~142, most of them date-stamped variants of the same family). Feeding the
 * whole catalog into the recommend classifier produces a 20–30KB prompt that a
 * cheap flash model cannot chew through reliably — the direct cause of the
 * real-environment classifier timeouts.
 *
 * This module shrinks the catalog into a bounded **selection scope**: up to 12
 * entries (4 tiers × 3 each). Model ids are **normalized** (version/date
 * suffixes stripped) so a model family collapses to one entry, and when the
 * same normalized id appears under several providers, the entry is kept on the
 * provider `autoProviderOrder` ranks first — matching on the configured
 * provider priority before anything else.
 *
 * The four tiers are derived from the naming metadata (cost × strength ×
 * specialty):
 *   - `cheapest`  — cost=low (flash/nano families)
 *   - `medium`    — cost=mid and strength=mid (balanced)
 *   - `strong`    — strength=strong, no specialty (generic pro/max)
 *   - `best`      — strength=strong with a code/reasoning/vision/math specialty
 *
 * `model` on an entry is a REAL, callable id (the winning instance's original
 * id) so a recommendation can be passed straight to `subagent_model`; the
 * normalized id is only the internal dedup key.
 */
import { modelMeta } from './meta.ts'
import type { ModelMeta } from './meta.ts'

/** One of the four selection tiers. */
export type SelectionTier = 'cheapest' | 'medium' | 'strong' | 'best'

/** Per-tier entry budget. */
export const TIERS_PER_SCOPE = 3

/** The resulting selection-scope ceiling (4 tiers × 3). */
export const SELECTION_SCOPE_MAX = 12

/** Canonical tier order, cheapest first. */
export const TIER_ORDER: readonly SelectionTier[] = ['cheapest', 'medium', 'strong', 'best']

/** One entry in the bounded selection scope. */
export type SelectionEntry = {
  /** Provider route that carries the entry (matching `autoProviderOrder` first). */
  readonly provider: string
  /** A real, callable model id (the winning instance of the normalized family). */
  readonly model: string
  /** The selection tier this entry represents. */
  readonly tier: SelectionTier
  /** Derived metadata for the normalized family. */
  readonly meta: ModelMeta
}

/**
 * Normalize a model id by stripping trailing version/date suffixes so a model
 * family collapses to one stable key:
 *   `qwen-plus-2025-01-25` / `qwen-plus-0112` / `qwen-plus-latest` → `qwen-plus`
 * Non-numeric tokens (`-14b`, `-a22b`, `k2.7-code`) are preserved.
 */
export function normalizeModelId(id: string): string {
  return id
    .replace(/-latest$/i, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '') // YYYY-MM-DD
    .replace(/-\d{4}$/, '')             // MMDD / YYYY
}

/** Classify a model family into its selection tier. */
export function tierOf(meta: ModelMeta): SelectionTier {
  if (meta.strength === 'strong' && meta.specialty.length > 0) return 'best'
  if (meta.strength === 'strong') return 'strong'
  if (meta.cost === 'low') return 'cheapest'
  return 'medium'
}

/** Provider rank map: listed providers first in order, unlisted after. */
function providerRank(providers: readonly string[], order: readonly string[]): Map<string, number> {
  const rank = new Map<string, number>()
  const merged = [...order, ...providers]
  merged.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index)
  })
  return rank
}

/**
 * Build the bounded selection scope from the raw catalog.
 *
 * Steps: normalize each id → keep one winning instance per normalized family
 * (provider `providerOrder` first, else raw catalog order) → group by tier →
 * sort each tier by provider rank then model id → take `TIERS_PER_SCOPE` each.
 */
export function buildSelectionScope(
  models: ReadonlyArray<{ id: string; name: string; provider: string }>,
  providerOrder: readonly string[] = [],
): SelectionEntry[] {
  const rank = providerRank(models.map(model => model.provider), providerOrder)

  // Normalize + keep the winning instance per family.
  const byFamily = new Map<string, SelectionEntry>()
  for (const model of models) {
    const normalized = normalizeModelId(model.id)
    const meta = modelMeta(normalized)
    const existing = byFamily.get(normalized)
    const rankHere = rank.get(model.provider) ?? Number.MAX_SAFE_INTEGER
    if (existing === undefined || rankHere < (rank.get(existing.provider) ?? Number.MAX_SAFE_INTEGER)) {
      byFamily.set(normalized, {
        provider: model.provider,
        model: model.id,
        tier: tierOf(meta),
        meta,
      })
    }
  }

  // Group by tier, sort each tier deterministically, take the budget.
  const out: SelectionEntry[] = []
  for (const tier of TIER_ORDER) {
    const inTier = [...byFamily.values()]
      .filter(entry => entry.tier === tier)
      .sort((a, b) => {
        const ra = rank.get(a.provider) ?? Number.MAX_SAFE_INTEGER
        const rb = rank.get(b.provider) ?? Number.MAX_SAFE_INTEGER
        if (ra !== rb) return ra - rb
        return a.model.localeCompare(b.model)
      })
    out.push(...inTier.slice(0, TIERS_PER_SCOPE))
  }
  return out
}
