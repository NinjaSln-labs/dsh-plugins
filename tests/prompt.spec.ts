import { describe, expect, it } from 'vitest'
import { wrapTaskPrompt } from '../src/prompt.ts'

describe('wrapTaskPrompt', () => {
  it('appends summary/status/body contract footer', () => {
    const wrapped = wrapTaskPrompt('List package name')
    expect(wrapped).toContain('List package name')
    expect(wrapped).toContain('<summary>')
    expect(wrapped).toContain('<status>')
    expect(wrapped).toContain('<body>')
  })
})
