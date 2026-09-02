/**
 * dsh-subagent-router — failure evidence + kind-specific health TTL (P3).
 *
 * Verifies that failure evidence carries retry-after and model-not-found
 * through the cause chain, and that the health store expires unhealthiness per
 * failure kind instead of one flat TTL.
 */
import { describe, expect, it, vi } from 'vitest'
import { extractFailureEvidence, isModelNotFoundError, classifyFailure, extractFailureEvidenceFromResult } from '../src/failure.ts'
import {
  RouteHealthStore,
  MODEL_NOT_FOUND_TTL_MS,
  RPM_ASSUMED_TTL_MS,
  RATE_LIMIT_BUFFER_MS,
} from '../src/health.ts'

describe('isModelNotFoundError', () => {
  it('matches unambiguous model-not-found wording', () => {
    expect(isModelNotFoundError('model not found')).toBe(true)
    expect(isModelNotFoundError('unknown model id')).toBe(true)
    expect(isModelNotFoundError('model is not supported')).toBe(true)
    expect(isModelNotFoundError('no such model')).toBe(true)
    expect(isModelNotFoundError('some unrelated server error')).toBe(false)
  })
})

describe('extractFailureEvidence', () => {
  it('carries retry-after through the cause chain', () => {
    const root = { message: 'rate limited', code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: 5000 }
    const evidence = extractFailureEvidence(root)
    expect(evidence.cls).toBe('rate-limit')
    expect(evidence.retryAfterMs).toBe(5000)
  })

  it('detects model-not-found via the message', () => {
    expect(extractFailureEvidence(new Error('model qwen-xxx not found on this route')).modelNotFound).toBe(true)
    expect(extractFailureEvidence(new Error('plain failure')).modelNotFound).toBeUndefined()
  })

  it('never throws on arbitrary values', () => {
    expect(() => extractFailureEvidence(undefined)).not.toThrow()
    expect(() => extractFailureEvidence(null)).not.toThrow()
    expect(() => extractFailureEvidence(42)).not.toThrow()
  })
})

describe('classifyFailure with status codes', () => {
  it('classifies 402 as quota', () => {
    expect(classifyFailure({ status: 402 })).toBe('quota')
  })

  it('classifies 429 as rate-limit', () => {
    expect(classifyFailure({ status: 429 })).toBe('rate-limit')
  })

  it('classifies 401 as auth', () => {
    expect(classifyFailure({ status: 401 })).toBe('auth')
  })

  it('classifies 500 as server', () => {
    expect(classifyFailure({ status: 500 })).toBe('server')
  })
})

describe('health store kind-specific TTL', () => {
  it('expires model-not-found after 24h', () => {
    vi.useFakeTimers()
    const store = new RouteHealthStore()
    store.record('a', { cls: 'other', modelNotFound: true })
    expect(store.isHealthy('a')).toBe(false)
    vi.advanceTimersByTime(MODEL_NOT_FOUND_TTL_MS - 1000)
    expect(store.isHealthy('a')).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(store.isHealthy('a')).toBe(true)
    vi.useRealTimers()
  })

  it('expires rate-limit without retry-after after the RPM-assumed window', () => {
    vi.useFakeTimers()
    const store = new RouteHealthStore()
    store.record('a', 'rate-limit')
    vi.advanceTimersByTime(RPM_ASSUMED_TTL_MS - 1000)
    expect(store.isHealthy('a')).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(store.isHealthy('a')).toBe(true)
    vi.useRealTimers()
  })

  it('expires rate-limit with retry-after just past the retry-after', () => {
    vi.useFakeTimers()
    const store = new RouteHealthStore()
    store.record('a', { cls: 'rate-limit', retryAfterMs: 10_000 })
    vi.advanceTimersByTime(10_000 + RATE_LIMIT_BUFFER_MS - 1000)
    expect(store.isHealthy('a')).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(store.isHealthy('a')).toBe(true)
    vi.useRealTimers()
  })
})

describe('extractFailureEvidenceFromResult', () => {
  it('detects Chinese quota wording in diagnostic', () => {
    const result = extractFailureEvidenceFromResult(
      '402: {"message":"您的deepseek-v4-flash免费额度已耗尽。如需继续使用，请更换模型代号为deepseek-v4-flash，并去充值。"}',
      [],
    )
    expect(result.cls).toBe('quota')
  })

  it('detects snake_case quota_exhausted in diagnostic', () => {
    const result = extractFailureEvidenceFromResult('free_request_quota_exhausted', [])
    expect(result.cls).toBe('quota')
  })

  it('detects English quota wording in diagnostic', () => {
    const result = extractFailureEvidenceFromResult('quota exhausted', [])
    expect(result.cls).toBe('quota')
  })

  it('detects model-not-found in diagnostic', () => {
    const result = extractFailureEvidenceFromResult('model deepseek-v4-flash not found', [])
    expect(result.cls).toBe('other')
    expect(result.modelNotFound).toBe(true)
  })

  it('returns other for empty diagnostic', () => {
    const result = extractFailureEvidenceFromResult('', [])
    expect(result.cls).toBe('other')
  })

  it('returns other for rate-limit text (not a quota signal)', () => {
    const result = extractFailureEvidenceFromResult('API rate limit exceeded', [])
    expect(result.cls).toBe('other')
  })

  it('falls back to output text when diagnostic is undefined', () => {
    const result = extractFailureEvidenceFromResult(undefined, [
      { type: 'text', text: 'quota exhausted' },
    ])
    expect(result.cls).toBe('quota')
  })
})
