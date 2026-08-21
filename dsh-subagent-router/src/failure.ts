/**
 * dsh-subagent-router — provider-side failure classification and sanitization.
 *
 * The subagent seam intentionally compresses a failed child into
 * `stopReason: 'error'`; the full `LlmFailure` (code, status, retry-after,
 * sanitized message) lives in the child's own log and never crosses back to
 * the tool layer. What this plugin CAN observe is the cause chain of a
 * `start()` rejection or a `run.result` rejection (infrastructure faults the
 * seam cannot represent as a stop reason). This module classifies whatever
 * cause is reachable into a stable, provider-neutral class and renders a
 * sanitized one-line detail for the tool result — so a caller sees
 * "provider quota exhausted" instead of a generic "subagent run failed".
 *
 * Classification routes on the harness's own stable vocabulary first
 * (`LlmError.code`, the `isQuotaExceededError` / `isContextWindowExceededError`
 * text classifiers, HTTP `status`), never on ad-hoc message parsing. Unknown
 * causes fall through to `other` — a failure class is only as trustworthy as
 * the evidence that produced it, and the auto policy must not reroute on
 * guesses.
 */
import {
  LlmError,
  errorChain,
  isContextWindowExceededError,
  isQuotaExceededError,
} from '@deepseek-ai/dsh-llm'

/** Stable, provider-neutral failure class used for routing decisions. */
export type FailureClass =
  /** Exhausted account quota / balance / budget — terminal until the account is refilled. */
  | 'quota'
  /** Transient request-rate limiting (HTTP 429) — may succeed again shortly. */
  | 'rate-limit'
  /** Credential / authorization failure — terminal until credentials are fixed. */
  | 'auth'
  /** Request exceeded the model context window — retrying elsewhere may help. */
  | 'context'
  /** Server-side or provider-internal error — transient-ish. */
  | 'server'
  /** Request timed out — transient-ish. */
  | 'timeout'
  /** Transport / network failure — transient-ish. */
  | 'transport'
  /** Not classifiable from the evidence available. */
  | 'other'

/** Stable failure-code vocabulary emitted by `LlmError` / `HarnessError`. */
const CODE_TO_CLASS: Record<string, FailureClass> = {
  RATE_LIMIT: 'rate-limit',
  QUOTA: 'quota',
  AUTH: 'auth',
  INVALID_CREDENTIAL: 'auth',
  CONTEXT_WINDOW_EXCEEDED: 'context',
  SERVER: 'server',
  TIMEOUT: 'timeout',
  TRANSPORT: 'transport',
  EMPTY_RESPONSE: 'other',
}

/** HTTP statuses that identify a failure class independent of any code. */
function classFromStatus(status: number): FailureClass | undefined {
  if (status === 429) return 'rate-limit'
  if (status === 401 || status === 403) return 'auth'
  if (status >= 500 && status <= 599) return 'server'
  return undefined
}

/** Walk an arbitrary thrown value and its cause chain looking for typed evidence. */
function findClass(value: unknown): FailureClass | undefined {
  const visited = new Set<unknown>()
  let current: unknown = value
  while (current !== undefined && current !== null && !visited.has(current)) {
    visited.add(current)
    if (current instanceof LlmError) {
      // LlmError carries an immutable `failure` with a stable `code`.
      const code = (current as unknown as { failure?: { code?: unknown } }).failure?.code
      if (typeof code === 'string') {
        const cls = CODE_TO_CLASS[code]
        if (cls !== undefined) return cls
      }
      const status = (current as unknown as { failure?: { status?: unknown } }).failure?.status
      if (typeof status === 'number') {
        const fromStatus = classFromStatus(status)
        if (fromStatus !== undefined) return fromStatus
      }
    }
    // Generic typed-error path (cross-realm / duck-typed LlmError).
    const candidate = current as { code?: unknown; status?: unknown; message?: unknown }
    if (typeof candidate?.code === 'string') {
      const cls = CODE_TO_CLASS[candidate.code]
      if (cls !== undefined) return cls
    }
    if (typeof candidate?.status === 'number') {
      const fromStatus = classFromStatus(candidate.status)
      if (fromStatus !== undefined) return fromStatus
    }
    // Text classifiers as a last resort for providers that flatten the code
    // into the message. These are deliberately conservative: they only match
    // unambiguous quota / context-window wording.
    if (typeof candidate?.message === 'string') {
      if (isQuotaExceededError(candidate.message)) return 'quota'
      if (isContextWindowExceededError(candidate.message)) return 'context'
    }
    // Follow AggregateError members first (they carry the real evidence),
    // then the cause chain.
    if (candidate instanceof AggregateError && Array.isArray(candidate.errors)) {
      for (const member of candidate.errors) {
        const memberClass = findClass(member)
        if (memberClass !== undefined) return memberClass
      }
    }
    current = (candidate as { cause?: unknown }).cause
  }
  return undefined
}

/** Classify an arbitrary thrown value; never throws, never guesses beyond evidence. */
export function classifyFailure(value: unknown): FailureClass {
  return findClass(value) ?? 'other'
}

/** Whether a failure class is terminal for the current route (retry is pointless). */
export function isTerminalForRoute(cls: FailureClass): boolean {
  return cls === 'quota' || cls === 'auth'
}

/** Whether a failure class is transient and worth an immediate retry / upgrade. */
export function isTransient(cls: FailureClass): boolean {
  // `other` (unclassified) counts as transient: it is still a route-failure
  // signal (e.g. a stopReason 'error' whose cause the seam did not expose), so
  // the health store treats it like any transient class and expires it after
  // the TTL instead of pinning the route as dead forever.
  return cls === 'rate-limit' || cls === 'server' || cls === 'timeout' || cls === 'transport' || cls === 'other'
}

const MAX_DETAIL_LENGTH = 400

/**
 * Render a sanitized, bounded one-line failure detail for a tool result.
 *
 * `errorChain` renders only message/name text with cycle protection and never
 * echoes credentials (the harness's own `assertUsableApiKey` guarantees keys
 * never enter messages). We additionally bound the length so a pathological
 * cause chain cannot bloat a tool result.
 */
export function sanitizeFailureDetail(value: unknown): string {
  const rendered = errorChain(value)
  if (rendered.length <= MAX_DETAIL_LENGTH) return rendered
  return `${rendered.slice(0, MAX_DETAIL_LENGTH)}…`
}

/** Human-readable label for a failure class, for audit reasons. */
export function failureLabel(cls: FailureClass): string {
  switch (cls) {
    case 'quota':
      return 'provider quota exhausted'
    case 'rate-limit':
      return 'provider rate-limited'
    case 'auth':
      return 'provider credential / authorization failure'
    case 'context':
      return 'context window exceeded'
    case 'server':
      return 'provider server error'
    case 'timeout':
      return 'provider request timed out'
    case 'transport':
      return 'transport / network failure'
    case 'other':
      return 'unclassified failure'
  }
}
