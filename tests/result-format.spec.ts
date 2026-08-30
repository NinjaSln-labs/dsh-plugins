import { describe, expect, it } from 'vitest'
import { formatForParent, parseResultText } from '../src/result-format.ts'
import { formatDiagnostic } from '../src/failure.ts'

describe('parseResultText', () => {
  it('extracts summary, status, and body when structured', () => {
    const parsed = parseResultText(
      '<summary>Listed package name</summary>\n<status>ok</status>\n<body>name: dsh-plugins</body>',
    )
    expect(parsed.structured).toBe(true)
    expect(parsed.summary).toBe('Listed package name')
    expect(parsed.status).toBe('ok')
    expect(parsed.body).toBe('name: dsh-plugins')
  })

  it('falls back to first line when unstructured', () => {
    const parsed = parseResultText('Done reading file.\nMore detail here.')
    expect(parsed.structured).toBe(false)
    expect(parsed.summary).toBe('Done reading file.')
    expect(parsed.body).toContain('More detail here.')
  })
})

describe('formatForParent', () => {
  it('puts summary first and wraps body in details', () => {
    const text = formatForParent({
      summary: 'Patched auth',
      status: 'ok',
      body: 'Touched src/auth.ts',
      structured: true,
    })
    expect(text.startsWith('Patched auth [ok]')).toBe(true)
    expect(text).toContain('<details>')
    expect(text).toContain('Touched src/auth.ts')
  })
})

describe('formatDiagnostic', () => {
  it('renders the closed-set line', () => {
    expect(formatDiagnostic({ stage: 'query-run', category: 'auth', runId: 'r1' }))
      .toBe('cursor:query-run/auth; run=r1')
  })
})
