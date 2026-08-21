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
 * Classification is conservative: only failures the plugin can actually
 * observe are recorded (start rejections and run.result infrastructure
 * rejections carry a cause chain; the ordinary `stopReason: 'error'` path does
 * not, but still records as `other` — a transient route-failure signal).
 * Terminal classes (`quota`, `auth`) mark the route unhealthy for the store's
 * lifetime; transient classes (`rate-limit`, `server`, `timeout`, `transport`,
 * and unclassified `other`) mark it unhealthy for a TTL so a momentary burst
 * does not permanently exile a route.
 *
 * The store lives with the tool registration fiber: it is created by
 * `registerModelPickerTools` and disposed with the tools, so no state
 * survives HMR replacement or plugin removal.
 */
import type { FailureClass } from './failure.ts'
import { isTerminalForRoute, isTransient } from './failure.ts'

/** Default TTL for transient-route unhealthiness, in milliseconds. */
export const DEFAULT_TRANSIENT_TTL_MS = 60_000

/** One observed failure entry for a route. */
type RouteFailure = {
  readonly cls: FailureClass
  /** Monotonic timestamp of the observation. */
  readonly at: number
}

/** Snapshot of one route's health, for the catalog tool and audit reasons. */
export type RouteHealth = {
  readonly healthy: boolean
  /** The failure class that currently marks the route unhealthy, when any. */
  readonly failingClass?: FailureClass
  /** Seconds until a transient mark expires; absent for terminal marks. */
  readonly retryAfterSec?: number
}

/**
 * Tracks per-route failure classification with TTL expiry for transient
 * classes. Safe for concurrent use (all mutations are synchronous).
 */
export class RouteHealthStore {
  private readonly failures = new Map<string, RouteFailure[]>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Record one observed failure for a provider route. */
  record(provider: string, cls: FailureClass): void {
    const list = this.failures.get(provider) ?? []
    list.push({ cls, at: this.now() })
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
    // Terminal failures never expire; transient ones expire after the TTL.
    let failing: { cls: FailureClass; at: number } | undefined
    const live: RouteFailure[] = []
    for (const entry of list) {
      if (isTransient(entry.cls) && now - entry.at >= DEFAULT_TRANSIENT_TTL_MS) {
        continue // expired transient
      }
      live.push(entry)
      // The most recent failure wins the headline.
      if (failing === undefined || entry.at >= failing.at) failing = entry
    }
    if (live.length === 0) {
      this.failures.delete(provider)
      return { healthy: true }
    }
    this.failures.set(provider, live)
    if (failing === undefined) return { healthy: true }
    const retryAfterSec = isTerminalForRoute(failing.cls)
      ? undefined
      : Math.max(0, Math.ceil((failing.at + DEFAULT_TRANSIENT_TTL_MS - now) / 1000))
    return {
      healthy: false,
      failingClass: failing.cls,
      ...retryAfterSec !== undefined ? { retryAfterSec } : {},
    }
  }

  /** Whether the route is currently usable — shorthand for `health().healthy`. */
  isHealthy(provider: string): boolean {
    return this.health(provider).healthy
  }
}
