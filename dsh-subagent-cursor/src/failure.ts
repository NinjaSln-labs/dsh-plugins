/**
 * Closed-set failure line for parent-facing error text.
 *
 * Shape: `cursor:<stage>/<category>[; run=<id>]`
 * Unknown evidence → category `unknown`. Never embed raw secrets or full stderr.
 */

export type FailureStage =
  | 'query-start'
  | 'query-run'
  | 'process'
  | 'teardown'
  | 'result'

export type FailureCategory =
  | 'auth'
  | 'timeout'
  | 'cancelled'
  | 'invalid-shape'
  | 'sdk'
  | 'unknown'

export type FailureDiagnostic = {
  readonly stage: FailureStage
  readonly category: FailureCategory
  readonly runId?: string
}

/** Render a bounded, stable diagnostic line. */
export function formatDiagnostic(d: FailureDiagnostic): string {
  const run = d.runId !== undefined && d.runId !== '' ? `; run=${d.runId}` : ''
  return `cursor:${d.stage}/${d.category}${run}`
}

/**
 * Map an SDK / transport error into the closed-set category.
 * Never inspects credential values — only error codes and message shapes.
 */
export function classifySdkError(error: unknown): FailureCategory {
  const message = error instanceof Error ? error.message : String(error)
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  const haystack = `${code} ${message}`.toLowerCase()

  if (/auth|unauthorized|forbidden|api[_\s-]?key|credential|login/.test(haystack)) {
    return 'auth'
  }
  if (/cancel|abort|aborted/.test(haystack)) {
    return 'cancelled'
  }
  if (/timeout|timed\s*out|deadline/.test(haystack)) {
    return 'timeout'
  }
  if (/invalid|shape|parse|schema/.test(haystack)) {
    return 'invalid-shape'
  }
  if (haystack.trim().length === 0) {
    return 'unknown'
  }
  return 'sdk'
}
