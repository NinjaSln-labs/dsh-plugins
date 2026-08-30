import { describe, expect, it, vi } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { startCursorRun } from '../src/run.ts'
import type { CreateSdkAgent, SdkAgent, SdkRunHandle } from '../src/sdk.ts'

function textPrompt(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

function fakeRequest(overrides: {
  prompt?: string
  signal?: AbortSignal
  cwd?: string
} = {}): SubagentStartRequest {
  return {
    prompt: textPrompt(overrides.prompt ?? 'do the thing'),
    parent: {
      session: {
        // resolveChildCwd requires an existing absolute directory
        header: { cwd: overrides.cwd ?? process.cwd() },
      },
    } as SubagentStartRequest['parent'],
    signal: overrides.signal ?? new AbortController().signal,
  }
}

function fakeRunHandle(partial: Partial<SdkRunHandle> & Pick<SdkRunHandle, 'wait'>): SdkRunHandle {
  return {
    cancel: async () => {},
    supports: () => true,
    ...partial,
  }
}

function fakeAgent(partial: Partial<SdkAgent> & Pick<SdkAgent, 'send'>): SdkAgent {
  return {
    agentId: 'agent-1',
    [Symbol.asyncDispose]: async () => {},
    ...partial,
  }
}

const baseDeps = {
  apiKey: 'test-key',
  model: 'composer-2.5',
  disposeGraceMs: 100,
}

describe('startCursorRun', () => {
  it('maps finished run to completed summary-first output', async () => {
    const run = await startCursorRun(fakeRequest({ prompt: 'x' }), {
      ...baseDeps,
      createAgent: (async () => fakeAgent({
        send: async () => fakeRunHandle({
          wait: async () => ({
            id: 'run-1',
            status: 'finished',
            result: '<summary>ok name</summary><status>ok</status><body>dsh-plugins</body>',
          }),
        }),
      })) satisfies CreateSdkAgent,
    })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output[0]).toMatchObject({ type: 'text' })
    expect(String((result.output[0] as { text: string }).text)).toContain('ok name')
    expect(String((result.output[0] as { text: string }).text)).toContain('<details>')
    await run.dispose()
    await run.dispose()
  })

  it('maps signal abort to aborted', async () => {
    const controller = new AbortController()
    let resolveWait!: (value: { id: string; status: 'cancelled' }) => void
    const waitPromise = new Promise<{ id: string; status: 'cancelled' }>((resolve) => {
      resolveWait = resolve
    })
    const cancel = vi.fn(async () => {
      resolveWait({ id: 'run-1', status: 'cancelled' })
    })

    const run = await startCursorRun(fakeRequest({ prompt: 'x', signal: controller.signal }), {
      ...baseDeps,
      createAgent: async () => fakeAgent({
        send: async () => fakeRunHandle({
          wait: () => waitPromise,
          cancel,
          supports: (op) => op === 'cancel' || op === 'wait',
        }),
      }),
    })

    controller.abort()
    const result = await run.result
    expect(result.stopReason).toBe('aborted')
    expect(cancel).toHaveBeenCalled()
    await run.dispose()
  })

  it('maps status error to stopReason error with cursor: diagnostic', async () => {
    const run = await startCursorRun(fakeRequest({ prompt: 'x' }), {
      ...baseDeps,
      createAgent: async () => fakeAgent({
        send: async () => fakeRunHandle({
          wait: async () => ({
            id: 'run-err',
            status: 'error',
            error: { message: 'boom', code: 'SDK_FAIL' },
          }),
        }),
      }),
    })
    const result = await run.result
    expect(result.stopReason).toBe('error')
    const text = String((result.output[0] as { text: string }).text)
    expect(text).toMatch(/cursor:query-run\//)
    expect(text).not.toContain('test-key')
    await run.dispose()
  })

  it('rejects start when apiKey missing', async () => {
    await expect(
      startCursorRun(fakeRequest({ prompt: 'x' }), {
        ...baseDeps,
        apiKey: '',
        createAgent: async () => {
          throw new Error('createAgent must not be called')
        },
      }),
    ).rejects.toThrow(/apiKey|CURSOR_API_KEY|auth/i)
  })

  it('rejects start when prompt is empty', async () => {
    await expect(
      startCursorRun(fakeRequest({ prompt: '   ' }), {
        ...baseDeps,
        createAgent: async () => {
          throw new Error('createAgent must not be called')
        },
      }),
    ).rejects.toThrow(/empty|prompt|task/i)
  })
})
