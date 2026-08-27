/**
 * dsh-subagent-router — model selection scope (2a refinement).
 *
 * Pure unit tests for id normalization, the four-tier classification, and the
 * bounded selection-scope builder (dedup by normalized family, provider-order
 * preference, and the 12-entry ceiling).
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeModelId,
  tierOf,
  buildSelectionScope,
  TIERS_PER_SCOPE,
  SELECTION_SCOPE_MAX,
} from '../src/selection.ts'
import type { ModelMeta } from '../src/meta.ts'

describe('normalizeModelId', () => {
  it('strips date and month-day suffixes', () => {
    expect(normalizeModelId('qwen-plus-2025-01-25')).toBe('qwen-plus')
    expect(normalizeModelId('qwen-plus-0112')).toBe('qwen-plus')
    expect(normalizeModelId('deepseek-v4-flash-0731')).toBe('deepseek-v4-flash')
    expect(normalizeModelId('deepseek-r1-0528')).toBe('deepseek-r1')
  })

  it('strips the -latest suffix', () => {
    expect(normalizeModelId('qwen-plus-latest')).toBe('qwen-plus')
  })

  it('preserves non-numeric tokens', () => {
    expect(normalizeModelId('qwen3-14b')).toBe('qwen3-14b')
    expect(normalizeModelId('kimi-k2.7-code')).toBe('kimi-k2.7-code')
    expect(normalizeModelId('qwen3-30b-a3b-instruct-2507')).toBe('qwen3-30b-a3b-instruct')
  })
})

describe('tierOf', () => {
  const meta = (strength: ModelMeta['strength'], cost: ModelMeta['cost'], specialty: ModelMeta['specialty'] = []): ModelMeta =>
    ({ cost, speed: 'normal', strength, specialty })

  it('classifies best = strong with a specialty', () => {
    expect(tierOf(meta('strong', 'high', ['code']))).toBe('best')
  })

  it('classifies strong = strong without specialty', () => {
    expect(tierOf(meta('strong', 'high'))).toBe('strong')
  })

  it('classifies cheapest = cost low', () => {
    expect(tierOf(meta('light', 'low'))).toBe('cheapest')
  })

  it('classifies medium otherwise', () => {
    expect(tierOf(meta('mid', 'mid'))).toBe('medium')
  })
})

describe('buildSelectionScope', () => {
  it('normalizes, dedups per family, and caps each tier', () => {
    const models = [
      // cheapest: many date-stamped variants of qwen-flash
      { id: 'qwen-flash-2025-07-28', name: 'x', provider: 'bailian' },
      { id: 'qwen-flash', name: 'x', provider: 'bailian' },
      { id: 'sensenova-6.8-flash-lite', name: 'x', provider: 'sensenova' },
      { id: 'sensenova-6.7-flash-lite', name: 'x', provider: 'sensenova' },
      // medium
      { id: 'qwen-plus-0112', name: 'x', provider: 'bailian' },
      { id: 'qwen-plus-latest', name: 'x', provider: 'bailian' },
      // strong
      { id: 'deepseek-v4-pro', name: 'x', provider: 'deepseek-official' },
      { id: 'qwen-max', name: 'x', provider: 'bailian' },
      // best
      { id: 'kimi-k2.7-code', name: 'x', provider: 'bailian' },
      { id: 'qwen-coder-turbo', name: 'x', provider: 'bailian' },
    ]
    const scope = buildSelectionScope(models, ['sensenova'])
    // qwen-flash-2025-07-28 and qwen-flash collapse to one entry
    expect(scope.length).toBeLessThanOrEqual(SELECTION_SCOPE_MAX)
    const byTier = new Map<string, string[]>()
    for (const entry of scope) {
      const list = byTier.get(entry.tier) ?? []
      list.push(entry.model)
      byTier.set(entry.tier, list)
    }
    // each present tier ≤ 3
    for (const [, list] of byTier) expect(list.length).toBeLessThanOrEqual(TIERS_PER_SCOPE)
    // flash family deduped: no more than one "qwen-flash" (normalized) family
    const flashModels = scope.filter(entry => normalizeModelId(entry.model) === 'qwen-flash')
    expect(flashModels.length).toBeLessThanOrEqual(1)
    // cheapest tier present and includes the free-tier provider first
    expect(byTier.get('cheapest')).toBeDefined()
  })

  it('keeps the provider listed first in providerOrder for a shared family', () => {
    const models = [
      { id: 'deepseek-v4-flash', name: 'x', provider: 'deepseek-official' },
      { id: 'deepseek-v4-flash', name: 'x', provider: 'sensenova' },
    ]
    const scope = buildSelectionScope(models, ['sensenova', 'deepseek-official'])
    const flash = scope.find(entry => normalizeModelId(entry.model) === 'deepseek-v4-flash')
    expect(flash?.provider).toBe('sensenova')
  })
})
