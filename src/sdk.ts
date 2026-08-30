/**
 * Injectable Cursor SDK facade — production wires `@cursor/sdk` Agent;
 * tests supply a fake createAgent.
 */
import { Agent } from '@cursor/sdk'
import type { Run, RunResult, RunOperation } from '@cursor/sdk'

/** Minimal run handle the driver needs (wait / cancel / capability probe). */
export type SdkRunHandle = {
  wait(): Promise<RunResult>
  cancel(): Promise<void>
  supports(operation: RunOperation): boolean
}

/** Minimal agent surface used by the one-shot driver. */
export type SdkAgent = {
  readonly agentId: string
  send(message: string): Promise<SdkRunHandle>
  [Symbol.asyncDispose](): Promise<void>
}

export type CreateSdkAgentOptions = {
  readonly apiKey: string
  readonly model: string
  readonly cwd: string
}

export type CreateSdkAgent = (options: CreateSdkAgentOptions) => Promise<SdkAgent>

function adaptRun(run: Run): SdkRunHandle {
  return {
    wait: () => run.wait(),
    cancel: () => run.cancel(),
    supports: (operation) => run.supports(operation),
  }
}

/** Default production factory: `Agent.create` + thin Run adapter. */
export const createSdkAgent: CreateSdkAgent = async (options) => {
  const agent = await Agent.create({
    apiKey: options.apiKey,
    model: { id: options.model },
    local: { cwd: options.cwd },
  })
  return {
    agentId: agent.agentId,
    send: async (message) => adaptRun(await agent.send(message)),
    [Symbol.asyncDispose]: () => agent[Symbol.asyncDispose](),
  }
}
