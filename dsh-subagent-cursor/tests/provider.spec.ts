import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedSubagentStartRequest, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { CursorProvider, type CursorStartRunner } from '../src/provider.ts'
import { resolveConfig } from '../src/index.ts'
import type { CursorRunDeps } from '../src/run.ts'

function fakeCtx(): Context {
  return {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    subagents: { registerProvider: () => {} },
  } as unknown as Context
}

function fakeResolvedRequest(cwd: string | undefined): ResolvedSubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'List package name' }],
    parent: {
      session: {
        header: cwd === undefined ? {} : { cwd },
      },
    },
    signal: new AbortController().signal,
    descriptor: {} as ResolvedSubagentStartRequest['descriptor'],
  } as ResolvedSubagentStartRequest
}

describe('CursorProvider.start', () => {
  it('start rejects when parent has no cwd', async () => {
    const provider = new CursorProvider(
      'cursor',
      fakeCtx(),
      resolveConfig({ env: { CURSOR_API_KEY: 'k' } }),
    )
    await expect(provider.start(fakeResolvedRequest(undefined))).rejects.toThrow(/cwd/i)
  })

  it('start delegates to startCursorRun with apiKey from env', async () => {
    const published: SubagentRun = {
      id: 'run-1' as SubagentRun['id'],
      localAgent: undefined,
      result: Promise.resolve({ output: [], stopReason: 'completed' }),
      dispose: async () => {},
    }
    let capturedRequest: ResolvedSubagentStartRequest | undefined
    let capturedDeps: CursorRunDeps | undefined
    const startRun: CursorStartRunner = async (request, deps) => {
      capturedRequest = request as ResolvedSubagentStartRequest
      capturedDeps = deps
      return published
    }
    const provider = new CursorProvider(
      'cursor',
      fakeCtx(),
      resolveConfig({
        model: 'composer-2.5',
        env: { CURSOR_API_KEY: 'from-env' },
        disposeGraceMs: 1500,
      }),
      startRun,
    )

    const request = fakeResolvedRequest(process.cwd())
    const run = await provider.start(request)
    expect(run).toBe(published)
    expect(capturedRequest).toBe(request)
    expect(capturedDeps).toMatchObject({
      apiKey: 'from-env',
      model: 'composer-2.5',
      disposeGraceMs: 1500,
    })
  })

  it('wires the real startCursorRun by default', async () => {
    const provider = new CursorProvider(
      'cursor',
      fakeCtx(),
      resolveConfig({ env: { CURSOR_API_KEY: '' } }),
    )
    // Empty key rejects inside startCursorRun — proves default runner is live.
    await expect(provider.start(fakeResolvedRequest(process.cwd()))).rejects.toThrow(/apiKey|CURSOR_API_KEY|auth/i)
  })
})
