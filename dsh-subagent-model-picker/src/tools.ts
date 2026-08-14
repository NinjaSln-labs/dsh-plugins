/**
 * dsh-subagent-model-picker — model-facing tools.
 *
 * `subagent_model`: delegation with per-call provider / model / max_tokens.
 * `subagent_models`: read-only catalog of live LLM provider routes and their
 * model listings (advisory; catalog membership never gates requests — it only
 * informs the delegating model).
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { settleRun } from '@deepseek-ai/dsh-subagent'
import type { SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { ModelPickerConfig } from './index.ts'

/** Render text blocks from the canonical JSON block array without trusting arbitrary values. */
function outputValueText(values: JsonValue[]): string {
  return values
    .filter((value): value is { type: 'text'; text: string } =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
      && value.type === 'text' && typeof value.text === 'string')
    .map(value => value.text)
    .join('')
}

/** Settle pending startup without rejecting the task producer contract. */
async function settleStart(start: Promise<SubagentRun>, signal: AbortSignal): Promise<JobOutcome> {
  try {
    return await settleRun(await start)
  } catch (error: unknown) {
    return signal.aborted
      ? { status: 'killed' }
      : { status: 'failed', detail: String(error) }
  }
}

/** A non-`completed` stop reason means the child did not finish cleanly. */
function stopReasonError(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'subagent run was cancelled'
    case 'error':
      return 'subagent run failed'
    case 'max-tokens':
      return 'subagent run hit its token limit before finishing'
    case 'refusal':
      return 'subagent declined the task'
    default:
      return `subagent run ended abnormally (${String(result.stopReason)})`
  }
}

/** Append the child's preserved partial answer to a stop-reason error. */
function withPartialText(error: string, output: ContentBlock[]): string {
  const text = output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  return text.length === 0 ? error : `${error}\nPartial output before the run ended:\n${text}`
}

type ForegroundToolResult = {
  readonly kind: 'foreground'
  readonly runId: SubagentRun['id']
  readonly output: JsonValue[]
}

/** Collect and release one foreground run without letting disposal replace an independent result failure. */
async function settleForegroundRun(run: SubagentRun): Promise<ForegroundToolResult> {
  const [execution] = await Promise.allSettled([
    run.result.then((result): ForegroundToolResult => {
      const error = stopReasonError(result)
      if (error !== undefined) {
        throw new Error(withPartialText(error, result.output))
      }
      return {
        kind: 'foreground',
        runId: run.id,
        output: result.output as unknown as JsonValue[],
      }
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `subagent run failed: ${String(execution.reason)}; dispose failed: ${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/** Resolve the model's optional scheduling request into one execution route. */
function resolveDelegationRun(
  request: { readonly run_in_background?: boolean },
  options: { readonly backgroundEnabled: boolean; readonly continuable: boolean },
): { readonly runInBackground: boolean } {
  if (!options.backgroundEnabled) {
    // The schema permits undeclared keys, so omission also needs execution-time enforcement.
    if (request.run_in_background === true) {
      throw new Error('run_in_background is disabled for this tool instance (enableRunInBackground: false)')
    }
    return { runInBackground: false }
  }
  return {
    runInBackground: request.run_in_background ?? options.continuable,
  }
}

/** One canonical delegation outcome the tool returns to the parent model. */
type DelegationToolResult =
  | { readonly kind: 'background'; readonly jobId: string }
  | { readonly kind: 'continuable'; readonly subagentId: string }
  | ForegroundToolResult

/**
 * Register the model-facing tools into `ctx.tools`. Returns the disposer that
 * unregisters both, owned by the caller's fiber.
 */
export function registerModelPickerTools(ctx: Context, config: Required<ModelPickerConfig>): () => void {
  const backgroundEnabled = config.enableRunInBackground
  const continuable = config.backgroundMode === 'continuable'
  const maxDepth = typeof config.maxDepth === 'number' ? config.maxDepth : undefined
  const disposers: Array<() => void> = []

  disposers.push(ctx.tools.register(defineTool({
    name: config.toolName,
    description: 'Delegate a self-contained task to a subagent (a separate agent that works in its own '
      + 'context) and choose the LLM route the child runs on. Unlike the plain subagent tool, the child '
      + 'does not have to inherit this agent\'s model: pass `provider` (an LLM provider route) and `model` '
      + '(a model id that provider accepts) to run the child on any registered model; omitted fields '
      + 'inherit this agent\'s route. Query `' + config.modelsToolName + '` for the live provider routes and '
      + 'their model catalogs before choosing. The child returns its result, not its intermediate steps. '
      + 'Give it a complete, standalone prompt: it does not see this conversation.'
      + (backgroundEnabled
        ? continuable
          ? ' This tool runs in the background by default, immediately returns a durable subagent id, and keeps the child conversation available for later turns. When that run settles, the runtime sends the parent a notice containing its outcome and any final assistant message; `send_message` starts a later turn in the same child conversation. Set `run_in_background: false` only when your next action depends on receiving the result.'
          : ' This call waits for the result by default. Set `run_in_background: true` to return a job id; collect with `job_output` and stop with `job_kill`.'
        : ' This call waits for the subagent and returns its result.'),
    parameters: {
      description: {
        type: 'string',
        required: true,
        description: 'A short (3-5 word) description of the delegated task, for display.',
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'The complete, self-contained task for the subagent. It does not share this conversation\'s context, so include everything it needs.',
      },
      provider: {
        type: 'string',
        description: 'LLM provider route the child runs on (e.g. deepseek-official). Defaults to this agent\'s provider. Must be a registered route; query ' + config.modelsToolName + ' for the live list.',
      },
      model: {
        type: 'string',
        description: 'Model id the child runs on (e.g. deepseek-v4-flash). Defaults to this agent\'s model. Must be a model the chosen provider accepts; query ' + config.modelsToolName + ' for the provider\'s catalog.',
      },
      max_tokens: {
        type: 'integer',
        description: 'Optional output token cap for the child (positive integer). Omitted caps inherit the parent\'s route.',
      },
      ...backgroundEnabled ? {
        run_in_background: {
          type: 'boolean' as const,
          description: continuable
            ? 'Whether to run in the background and return a durable subagent id immediately. Defaults to true. Set false to wait for the result when your next action depends on it.'
            : 'Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill.',
        },
      } : {},
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'background' },
              jobId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'continuable' },
              subagentId: { type: 'string', required: true },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              runId: { type: 'string', required: true },
              output: { type: 'array', required: true, items: { type: 'json' } },
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? `started background subagent task ${value.jobId}`
          : value.kind === 'continuable'
            ? `started subagent ${value.subagentId}`
            : outputValueText(value.output),
      }],
    },
    // Children never mutate the parent session; the one parent-owned write
    // (tasks.start) is a synchronous commutative insertion.
    isConcurrencySafe: () => true,
    async execute(args: {
      description: string
      prompt: string
      provider?: string
      model?: string
      max_tokens?: number
      run_in_background?: boolean
    }, exec): Promise<DelegationToolResult> {
      const parent = exec.agent
      if (!parent) {
        throw new Error(`${config.toolName} tool requires a calling agent (exec.agent was undefined)`)
      }

      // ---- per-call model route ----
      const agentOptions: { provider?: string; model?: string; maxTokens?: number } = {}
      if (args.provider !== undefined) {
        const llm = ctx.get('llm')
        if (llm === undefined) {
          throw new Error(`${config.toolName}: provider selection requires the llm service (no ctx.llm registered)`)
        }
        const routes = llm.listProviders()
        if (!routes.some(route => route.id === args.provider)) {
          const known = routes.map(route => route.id).join(', ')
          throw new Error(
            `${config.toolName}: unknown provider "${args.provider}" — registered provider routes: ${known || '(none)'}`,
          )
        }
        agentOptions.provider = args.provider
      }
      if (args.model !== undefined) {
        if (args.model.length === 0) throw new Error(`${config.toolName}: model must be a non-empty string`)
        agentOptions.model = args.model
      }
      if (args.max_tokens !== undefined) {
        if (!Number.isSafeInteger(args.max_tokens) || args.max_tokens <= 0) {
          throw new Error(`${config.toolName}: max_tokens must be a positive integer`)
        }
        agentOptions.maxTokens = args.max_tokens
      }

      const request = {
        label: args.description,
        prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
        parent,
        agentOptions,
        ...maxDepth !== undefined ? { maxDepth } : {},
      }

      const runSpec = resolveDelegationRun(args, { backgroundEnabled, continuable })
      if (runSpec.runInBackground) {
        if (continuable) {
          // Resolves at inbox acceptance: the child owns its own turns from
          // there, so this call neither waits for nor collects a result.
          const started = await ctx.subagents.startContinuable({
            provider: config.subagentProvider,
            label: args.description,
            request,
            signal: exec.signal,
          })
          return { kind: 'continuable', subagentId: String(started.childId) }
        }
        const jobs = ctx.get('jobs')
        if (jobs === undefined) {
          throw new Error('background jobs unavailable: load @deepseek-ai/dsh-jobs and @deepseek-ai/dsh-tool-jobs')
        }
        const id = jobs.start({
          kind: 'subagent',
          label: args.description,
          owner: parent,
          run: () => {
            const controller = new AbortController()
            const start = ctx.subagents.start(config.subagentProvider, { ...request, signal: controller.signal })
            return {
              cancel: (reason?: string) => {
                controller.abort(reason ?? 'background subagent task killed')
              },
              done: settleStart(start, controller.signal),
            }
          },
        })
        return { kind: 'background', jobId: id }
      }

      const run: SubagentRun = await ctx.subagents.start(config.subagentProvider, {
        ...request,
        signal: exec.signal,
      })
      return settleForegroundRun(run)
    },
  })))

  if (config.enableModelList) {
    disposers.push(ctx.tools.register(defineTool({
      name: config.modelsToolName,
      description: 'List the live LLM provider routes registered on this harness and, for each, the model '
        + 'catalog its adapter advertises. Advisory: catalog membership never gates requests — a provider '
        + 'may still accept model ids outside its listing — but this is the authoritative way to see what '
        + '`' + config.toolName + '` can target. Pass `provider` to narrow to one route.',
      parameters: {
        provider: {
          type: 'string',
          description: 'Only list this provider route; omit to list every registered route.',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => true,
      async execute(args: { provider?: string }): Promise<JsonValue> {
        const llm = ctx.get('llm')
        if (llm === undefined) {
          return { providers: [], note: 'llm service unavailable on this harness' }
        }
        type ProviderCatalogEntry = {
          provider: string
          name: string
          models: Array<{ id: string; name: string }>
          error?: string
        }
        const routes = llm.listProviders()
        const wanted = args.provider
        const providers: ProviderCatalogEntry[] = []
        for (const route of routes) {
          if (wanted !== undefined && route.id !== wanted) continue
          let models: Array<{ id: string; name: string }> = []
          let error: string | undefined
          try {
            models = (await llm.listModels(route.id)).map(model => ({ id: model.id, name: model.name }))
          } catch (cause) {
            error = String(cause)
          }
          providers.push({
            provider: route.id,
            name: route.name,
            models,
            ...error !== undefined ? { error } : {},
          })
        }
        if (wanted !== undefined && providers.length === 0) {
          const known = routes.map(route => route.id).join(', ')
          return { providers: [], note: `unknown provider "${wanted}" — registered provider routes: ${known || '(none)'}` }
        }
        return { providers }
      },
    })))
  }

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
