/**
 * dsh-subagent-router — model metadata derivation (ROADMAP 1c).
 *
 * Pure unit tests for `modelMeta`: naming-signal cost/speed/strength/specialty
 * derivation and the known context-window map. Zero runtime deps.
 */
import { describe, expect, it } from 'vitest'
import { modelMeta } from '../src/meta.ts'

describe('modelMeta', () => {
  it('classifies strong vs light vs mid by naming', () => {
    expect(modelMeta('deepseek-v4-pro').strength).toBe('strong')
    expect(modelMeta('deepseek-v4-flash').strength).toBe('light')
    expect(modelMeta('some-model').strength).toBe('mid')
  })

  it('maps strength to cost tier', () => {
    expect(modelMeta('deepseek-v4-pro').cost).toBe('high')
    expect(modelMeta('deepseek-v4-flash').cost).toBe('low')
    expect(modelMeta('some-model').cost).toBe('mid')
  })

  it('derives speed: light → fast, reasoning → slow, else normal', () => {
    expect(modelMeta('deepseek-v4-flash').speed).toBe('fast')
    expect(modelMeta('deepseek-r1').speed).toBe('slow')
    expect(modelMeta('some-model').speed).toBe('normal')
  })

  it('detects specialties from naming', () => {
    expect(modelMeta('deepseek-coder').specialty).toContain('code')
    expect(modelMeta('deepseek-r1').specialty).toContain('reasoning')
    expect(modelMeta('gpt-4o').specialty).toContain('vision')
    expect(modelMeta('some-model').specialty).toEqual([])
  })

  it('attaches contextWindow only for known ids', () => {
    expect(modelMeta('deepseek-v4-pro').contextWindow).toBe('128k')
    expect(modelMeta('gemini-3.0-pro').contextWindow).toBe('1m')
    expect(modelMeta('unknown-model').contextWindow).toBeUndefined()
  })

  it('never throws on arbitrary ids', () => {
    expect(() => modelMeta('')).not.toThrow()
    expect(() => modelMeta('@@@')).not.toThrow()
  })
})
