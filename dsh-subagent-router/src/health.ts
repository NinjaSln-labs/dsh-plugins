/**
 * dsh-subagent-router — in-process per-route health tracking.
 *
 * The auto policy anchors to the calling agent's own model by default. That
 * anchor is only sound while the parent's route is healthy: if the parent's
 * provider is quota-exhausted or its credentials are broken, every child
 * pinned to that route fails identically. This store records observed
 * failures per provider route so the auto policy can detect a "dead anchor"
 * and reroute to a healthy route instead of repeatedly delegating into a
 * known-bad one.
 *
 * Unhealthiness expires per failure kind instead of one flat TTL:
 *   - `auth` (credential/authorization)  → terminal (never expires)
 *   - model-not-found / unsupported      → 24h
 *   - `rate-limit` with a retry-after    → retry-after + buffer
 *   - `rate-limit` without               → ~35s (RPM assumed)
 *   - `quota`                            → next clock-hour boundary
 *   - `context`/`server`/`timeout`/`transport` → 60s
 *   - unclassified `other`               → 5min default
 *
 * The store lives with the tool registration fiber: it is created by
 * `registerModelPickerTools` and disposed with the tools, so no state
 * survives HMR replacement or plugin removal.
 */
import { failureLabel } from './failure.ts'
import type { FailureClass, FailureEvidence } from './failure.ts'

/** Default TTL for transient-route unhealthiness, in milliseconds (60s). */
export const DEFAULT_TRANSIENT_TTL_MS = 60_000

/** Unhealthiness window for an unknown/unsupported model (24h). */
export const MODEL_NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000

/** Assumed per-minute rate-limit window when no retry-after is present (~35s). */
export const RPM_ASSUMED_TTL_MS = 35_000

/** Buffer added to a provider-issued retry-after so expiry lands just past it. */
export const RATE_LIMIT_BUFFER_MS = 1_000

/** Default unhealthiness window when no failure detail is classifiable (5min). */
export const DEFAULT_UNCLASSIFIED_TTL_MS = 5 * 60_000

/** One observed failure entry for a route, with a kind-specific expiry. */
type RouteFailure = {
  readonly cls: FailureClass
  /** Monotonic timestamp of the observation. */
  readonly at: number
  /** Expiry timestamp; `Infinity` marks a terminal (never-expiring) failure. */
  readonly expireAt: number
  /** Human-readable reason for the expiry choice (audit). */
  readonly label: string
}

/** How an evidence resolves into unhealthiness duration. */
type TtlResolution = {
  readonly kind: 'terminal' | 'ttl' | 'next-hour'
  readonly ttlMs?: number
  readonly label: string
}

/** Milliseconds until the next clock-hour boundary (00:00 of the next hour). */
function nextHourBoundaryMs(now: number): number {
  const HOUR_MS = 60 * 60 * 1000
  return HOUR_MS - (now % HOUR_MS)
}

/** Map failure evidence to an expiry, by kind. */
function resolveTtl(evidence: FailureEvidence): TtlResolution {
  const { cls, retryAfterMs, modelNotFound } = evidence
  if (cls === 'auth') return { kind: 'terminal', label: 'auth / credential failure' }
  if (modelNotFound === true) return { kind: 'ttl', ttlMs: MODEL_NOT_FOUND_TTL_MS, label: 'model not found / unsupported' }
  if (cls === 'rate-limit') {
    if (retryAfterMs !== undefined && retryAfterMs > 0) {
      return { kind: 'ttl', ttlMs: retryAfterMs + RATE_LIMIT_BUFFER_MS, label: 'rate limited (retry-after)' }
    }
    return { kind: 'ttl', ttlMs: RPM_ASSUMED_TTL_MS, label: 'rate limited (RPM assumed)' }
  }
  if (cls === 'quota') return { kind: 'next-hour', label: 'quota exhausted (next hour boundary)' }
  if (cls === 'context' || cls === 'server' || cls === 'timeout' || cls === 'transport') {
    return { kind: 'ttl', ttlMs: DEFAULT_TRANSIENT_TTL_MS, label: failureLabel(cls) }
  }
  return { kind: 'ttl', ttlMs: DEFAULT_UNCLASSIFIED_TTL_MS, label: 'unclassified (default TTL)' }
}

/** Snapshot of one route's health, for the catalog tool and audit reasons. */
export type RouteHealth = {
  readonly healthy: boolean
  /** The failure class that currently marks the route unhealthy, when any. */
  readonly failingClass?: FailureClass
  /** Human-readable reason for the current unhealthiness, when any. */
  readonly failingLabel?: string
  /** Seconds until the mark expires; absent for terminal marks. */
  readonly retryAfterSec?: number
}

/**
 * Tracks per-route failure classification with kind-specific expiry. Safe for
 * concurrent use (all mutations are synchronous).
 */
export class RouteHealthStore {
  private readonly failures = new Map<string, RouteFailure[]>()

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Record one observed failure for a provider route. Accepts either a coarse
   * class (legacy) or full evidence (class + retry-after + model-not-found).
   */
  record(provider: string, failure: FailureClass | FailureEvidence): void {
    const evidence: FailureEvidence = typeof failure === 'string' ? { cls: failure } : failure
    const resolution = resolveTtl(evidence)
    const at = this.now()
    const expireAt = resolution.kind === 'terminal'
      ? Infinity
      : resolution.kind === 'next-hour'
        ? at + nextHourBoundaryMs(at)
        : at + (resolution.ttlMs ?? DEFAULT_UNCLASSIFIED_TTL_MS)
    const list = this.failures.get(provider) ?? []
    list.push({ cls: evidence.cls, at, expireAt, label: resolution.label })
    this.failures.set(provider, list)
  }

  /** Drop all observations for one route (used on provider removal). */
  clear(provider: string): void {
    this.failures.delete(provider)
  }

  /** Snapshot the current health of one route. */
  health(provider: string): RouteHealth {
    const list = this.failures.get(provider)
    if (list === undefined || list.length === 0) return { healthy: true }
    const now = this.now()
    let failing: RouteFailure | undefined
    const live: RouteFailure[] = []
    for (const entry of list) {
      if (entry.expireAt <= now) continue // expired
      live.push(entry)
      if (failing === undefined || entry.at >= failing.at) failing = entry
    }
    if (live.length === 0) {
      this.failures.delete(provider)
      return { healthy: true }
    }
    this.failures.set(provider, live)
    if (failing === undefined) return { healthy: true }
    const retryAfterSec = failing.expireAt === Infinity
      ? undefined
      : Math.max(0, Math.ceil((failing.expireAt - now) / 1000))
    return {
      healthy: false,
      failingClass: failing.cls,
      failingLabel: failing.label,
      ...retryAfterSec !== undefined ? { retryAfterSec } : {},
    }
  }

  /** Whether the route is currently usable — shorthand for `health().healthy`. */
  isHealthy(provider: string): boolean {
    return this.health(provider).healthy
  }
}
