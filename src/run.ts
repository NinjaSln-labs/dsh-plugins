/**
 * SDK one-shot run driver: cwd resolve → Agent.create/send → map RunResult →
 * SubagentRun (cancel, dispose, never-reject result after publication).
 */
import { randomUUID } from 'node:crypto'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  resolveChildCwd,
  settleRunResult,
  subprocessRunHandle,
  type SubagentResult,
  type SubagentRun,
  type SubagentStartRequest,
  type SubagentStopReason,
} from '@deepseek-ai/dsh-subagent'
import type { RunResult } from '@cursor/sdk'
import { classifySdkError, formatDiagnostic, type FailureStage } from './failure.ts'
import { wrapTaskPrompt } from './prompt.ts'
import { formatForParent, parseResultText } from './result-format.ts'
import { createSdkAgent, type CreateSdkAgent, type SdkAgent, type SdkRunHandle } from './sdk.ts'

const PREFIX = 'dsh-subagent-cursor'

export type CursorRunDeps = {
  readonly createAgent?: CreateSdkAgent
  readonly apiKey: string
  readonly model: string
  readonly disposeGraceMs: number
  /** Load-validated cwd override; omit to use parent session cwd. */
  readonly configuredCwd?: string
  readonly onError?: (error: Error, stopReason: SubagentStopReason) => void
}

/** Join text-only prompt blocks; reject empty / non-text tasks before publication. */
export function textTask(prompt: readonly ContentBlock[]): string {
  if (prompt.length === 0) {
    throw new Error(`${PREFIX}: the one-shot task must contain only text blocks`)
  }
  const texts: string[] = []
  for (const block of prompt) {
    if (block.type !== 'text') {
      throw new Error(`${PREFIX}: the one-shot task must contain only text blocks`)
    }
    texts.push(block.text)
  }
  if (texts.every((text) => text.trim().length === 0)) {
    throw new Error(`${PREFIX}: the one-shot task must not be empty`)
  }
  return texts.join('')
}

function textOutput(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

function mapRunResult(run: RunResult): SubagentResult {
  if (run.status === 'finished') {
    const raw = run.result ?? ''
    const formatted = formatForParent(parseResultText(raw))
    return { output: textOutput(formatted), stopReason: 'completed' }
  }
  if (run.status === 'cancelled') {
    return {
      output: textOutput(formatDiagnostic({ stage: 'query-run', category: 'cancelled', runId: run.id })),
      stopReason: 'aborted',
    }
  }
  const category = classifySdkError(run.error ?? new Error(run.result ?? 'sdk error'))
  const line = formatDiagnostic({ stage: 'query-run', category, runId: run.id })
  const detail = run.error?.message?.trim() || run.result?.trim() || 'run failed'
  return {
    output: textOutput(`${line}\n${detail}`),
    stopReason: 'error',
  }
}

async function disposeCursorAgent(
  agent: SdkAgent | undefined,
  handle: SdkRunHandle | undefined,
): Promise<void> {
  const failures: Error[] = []
  if (handle !== undefined && handle.supports('cancel')) {
    try {
      await handle.cancel()
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  if (agent !== undefined) {
    try {
      await agent[Symbol.asyncDispose]()
    } catch (error) {
      failures.push(error instanceof Error ? error : new Error(String(error)))
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, `${PREFIX}: agent cleanup failed`)
  }
}

/**
 * Publish one Cursor SDK one-shot run. Pre-publication failures reject;
 * post-publication failures settle through `result` (never reject).
 */
export async function startCursorRun(
  request: SubagentStartRequest,
  deps: CursorRunDeps,
): Promise<SubagentRun> {
  const apiKey = deps.apiKey.trim()
  if (apiKey.length === 0) {
    throw new Error(`${PREFIX}: CURSOR_API_KEY / apiKey is required (query-start/auth)`)
  }

  const userText = textTask(request.prompt)
  if (request.signal.aborted) {
    throw new Error(`${PREFIX}: request was aborted before SDK startup`)
  }

  const parentCwd = request.parent.session.header.cwd
  const cwd = resolveChildCwd(PREFIX, deps.configuredCwd, parentCwd)
  const prompt = wrapTaskPrompt(userText)
  const createAgent = deps.createAgent ?? createSdkAgent

  const controller = new AbortController()
  let activeHandle: SdkRunHandle | undefined

  const requestCancel = () => {
    if (!controller.signal.aborted) {
      controller.abort(new Error(`${PREFIX}: run cancelled locally`))
    }
    const handle = activeHandle
    if (handle !== undefined && handle.supports('cancel')) {
      void handle.cancel().catch(() => {})
    }
  }
  const onAbort = () => {
    requestCancel()
  }
  request.signal.addEventListener('abort', onAbort, { once: true })

  let agent: SdkAgent | undefined
  try {
    agent = await createAgent({ apiKey, model: deps.model, cwd })
    if (controller.signal.aborted || request.signal.aborted) {
      throw new Error(`${PREFIX}: request was aborted before SDK startup`)
    }
    activeHandle = await agent.send(prompt)
    if (controller.signal.aborted || request.signal.aborted) {
      throw new Error(`${PREFIX}: request was aborted before SDK startup`)
    }
  } catch (error) {
    request.signal.removeEventListener('abort', onAbort)
    const cancelledBeforeCleanup = controller.signal.aborted || request.signal.aborted
    requestCancel()
    try {
      await disposeCursorAgent(agent, activeHandle)
    } catch (disposeError) {
      throw new AggregateError(
        [
          error instanceof Error ? error : new Error(String(error)),
          disposeError instanceof Error ? disposeError : new Error(String(disposeError)),
        ],
        `${PREFIX}: startup failed and cleanup also failed`,
      )
    }
    if (cancelledBeforeCleanup) {
      throw new Error(`${PREFIX}: request was aborted before SDK startup`)
    }
    throw error instanceof Error ? error : new Error(String(error))
  }

  const publishedAgent = agent
  const publishedHandle = activeHandle!

  void deps.disposeGraceMs

  const result = settleRunResult({
    attempt: async () => {
      try {
        const runResult = await publishedHandle.wait()
        return mapRunResult(runResult)
      } catch (error) {
        const stage: FailureStage = 'query-run'
        const category = classifySdkError(error)
        const line = formatDiagnostic({ stage, category })
        const message = error instanceof Error ? error.message : String(error)
        return {
          output: textOutput(`${line}\n${message}`),
          stopReason: 'error' as const,
        }
      }
    },
    collectOutput: () => [],
    cancelled: () => controller.signal.aborted,
    onError: deps.onError,
    signal: request.signal,
    onAbort,
  })

  return subprocessRunHandle({
    id: SessionId(randomUUID()),
    result,
    signal: request.signal,
    onAbort,
    requestCancel,
    teardown: () => disposeCursorAgent(publishedAgent, publishedHandle),
  })
}
