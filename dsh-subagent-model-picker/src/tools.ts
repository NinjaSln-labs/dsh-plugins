/**
 * dsh-subagent-model-picker — model-facing tools.
 *
 * `subagent_model`: delegation with per-call provider / model / max_tokens.
 * Passing `model: "auto"` delegates model choice to the built-in auto policy:
 * it anchors to the calling agent's own model by default, upgrades to a
 * stronger catalog model only when the task is heavy and the parent model is
 * not a strong one, and records the decision with its reason on the result.
 * Foreground calls retry once on the next tier up after a failed run
 * (`autoEscalate`), never downgrading.
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
  readonly auto?: AutoDecision
}

/** One canonical delegation outcome the tool returns to the parent model. */
type DelegationToolResult =
  | { readonly kind: 'background'; readonly jobId: string; readonly auto?: AutoDecision }
  | { readonly kind: 'continuable'; readonly subagentId: string; readonly auto?: AutoDecision }
  | ForegroundToolResult

/** Built-in auto-selection tier for `model: "auto"`. */
type AutoTier = 'trivial' | 'standard' | 'complex'

/** The audit record of one `model: "auto"` decision, returned to the caller. */
type AutoDecision = {
  readonly provider: string
  readonly model: string
  readonly tier: AutoTier
  readonly reason: string
  /** Set when the foreground run failed and the retry escalated tiers. */
  readonly escalatedFrom?: string
  /** Set when the choice stayed on the calling agent's own model. */
  readonly anchored?: boolean
}

/** A resolved auto selection plus its optional one-step escalation target. */
type AutoSelection = {
  readonly decision: AutoDecision
  readonly escalation: { readonly id: string; readonly tier: AutoTier; readonly reason: string } | undefined
}

/** Task markers that push the auto tier toward `complex`. */
const COMPLEX_MARKERS = [
  /```|=>|#include|require\(/,
  /\b(function|class|interface|import|export|const|def)\s/,
  /\b(JSON|schema|structured|matrix|architecture|algorithm)\b/i,
  /\b(analy[sz]e|architect|design|optimize|debug|refactor|synthesi[sz]e|evaluate|investigate|research|derive|proof|implement|migrate|complex)\b/i,
]

/** Model-id signals for a strong / reasoning model. */
const STRONG_MODEL = /\b(pro|max|reason|think|ultra|code|turbo|large|deep)\b/i

/** Model-id signals for a cheap / fast model. */
const LIGHT_MODEL = /\b(flash|mini|lite|fast|small|quick|nano|light)\b/i

/** Classify a delegation task into the auto-selection tier. */
function classifyTier(description: string, prompt: string): AutoTier {
  const task = `${description}\n${prompt}`
  if (task.length >= 1200 || COMPLEX_MARKERS.some(marker => marker.test(task))) return 'complex'
  if (task.length <= 160) return 'trivial'
  return 'standard'
}

/** One-line justification of a tier for the audit reason. */
function tierNote(tier: AutoTier): string {
  switch (tier) {
    case 'trivial':
      return 'short task without heavy markers'
    case 'complex':
      return 'long task or heavy markers (code / structured output / reasoning verbs)'
    case 'standard':
      return 'ordinary task length and content'
  }
}

/** Naming-based strength score: +1 strong signals, -1 cheap signals. */
function modelScore(id: string): number {
  let score = 0
  if (STRONG_MODEL.test(id)) score += 1
  if (LIGHT_MODEL.test(id)) score -= 1
  return score
}

/** Pick the catalog model best matching a tier (ties keep catalog order). */
function pickModel(models: readonly { id: string }[], tier: AutoTier): { id: string; score: number } | undefined {
  if (models.length === 0) return undefined
  const scored = models.map(model => ({ id: model.id, score: modelScore(model.id) }))
  switch (tier) {
    case 'trivial': {
      const min = Math.min(...scored.map(entry => entry.score))
      return scored.find(entry => entry.score === min)
    }
    case 'complex': {
      const max = Math.max(...scored.map(entry => entry.score))
      return scored.find(entry => entry.score === max)
    }
    case 'standard':
      return scored.find(entry => entry.score === 0) ?? scored[0]
  }
}

/** One-tier escalation ladder; the top tier has no next tier. */
const NEXT_TIER: Record<AutoTier, AutoTier | undefined> = {
  trivial: 'standard',
  standard: 'complex',
  complex: undefined,
}

/** Append the audit line for an auto decision to a tool render. */
function autoRender(auto: AutoDecision | undefined): string {
  if (auto === undefined) return ''
  const anchor = auto.anchored === true ? ' anchored' : ''
  const escalation = auto.escalatedFrom === undefined ? '' : ` (escalated from ${auto.escalatedFrom})`
  return `\n[auto] provider=${auto.provider} model=${auto.model} tier=${auto.tier}${anchor}${escalation}\nreason: ${auto.reason}`
}

/** Output-schema fragment for the auditable auto decision. */
const AUTO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
    tier: { type: 'string', required: true },
    reason: { type: 'string', required: true },
    escalatedFrom: { type: 'string' },
    anchored: { type: 'boolean' },
  },
} as const

/**
 * Resolve `model: "auto"` against the provider catalog. The provider is the
 * explicit argument, else the calling agent's own route (`parent.options`).
 *
 * The choice is ANCHORED to the calling agent by default: when the parent's
 * options name a model on the resolved provider, that model is used as-is
 * unless the task classifies `complex` and the parent's model is not a strong
 * one (then the strongest catalog model is picked). Only when no parent model
 * is available does the policy fall back to catalog tier picks. Escalation
 * never downgrades: the next tier is used only when it scores strictly
 * stronger than the current choice.
 *
 * Catalog membership is advisory, so the resolved id is only a pick: the
 * provider still owns rejection, exactly as with an explicit model.
 */
async function resolveAutoSelection(
  ctx: Context,
  args: { readonly provider?: string; readonly description: string; readonly prompt: string },
  parentProvider: string | undefined,
  parentModel: string | undefined,
  toolName: string,
): Promise<AutoSelection> {
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throw new Error(`${toolName}: model "auto" requires the llm service (no ctx.llm registered)`)
  }
  const provider = args.provider ?? parentProvider
  if (provider === undefined) {
    throw new Error(
      `${toolName}: model "auto" needs a provider route — pass "provider" explicitly, or call from an agent `
      + 'whose options name one (parent.options.provider)',
    )
  }
  const routes = llm.listProviders()
  if (!routes.some(route => route.id === provider)) {
    const known = routes.map(route => route.id).join(', ')
    throw new Error(
      `${toolName}: model "auto": unknown provider "${provider}" — registered provider routes: ${known || '(none)'}`,
    )
  }
  let models: Array<{ id: string; name: string }>
  try {
    models = await llm.listModels(provider)
  } catch (cause) {
    throw new Error(`${toolName}: model "auto" could not list models for provider "${provider}": ${String(cause)}`)
  }
  const tier = classifyTier(args.description, args.prompt)
  // The anchor is the parent's own model, valid only on the parent's own
  // provider — an explicit `provider` argument switches groups, so the
  // parent's model no longer belongs there.
  const anchor = parentModel !== undefined && parentModel.length > 0 && parentProvider === provider
    ? parentModel
    : undefined
  const anchorScore = anchor === undefined ? undefined : modelScore(anchor)
  let pick: { id: string; score: number } | undefined
  let anchored = false
  if (anchor !== undefined && (tier !== 'complex' || anchorScore! >= 1)) {
    // Default: stay on the calling agent's own model.
    pick = { id: anchor, score: anchorScore! }
    anchored = true
  } else {
    pick = pickModel(models, tier)
  }
  if (pick === undefined) {
    throw new Error(`${toolName}: model "auto": provider "${provider}" advertises no models`)
  }
  const reason = anchored
    ? `auto policy: task classified "${tier}" (${tierNote(tier)}); defaulted to the parent's own model "${pick.id}" on provider "${provider}"`
    : anchor !== undefined
      ? `auto policy: task classified "${tier}" (${tierNote(tier)}); upgraded from the parent's model "${anchor}" to "${pick.id}" on provider "${provider}"`
      : `auto policy: task classified "${tier}" (${tierNote(tier)}), picked "${pick.id}" from provider "${provider}"`
  const decision: AutoDecision = {
    provider,
    model: pick.id,
    tier,
    reason,
    ...anchored ? { anchored: true } : {},
  }
  const nextTier = NEXT_TIER[tier]
  let escalation: { id: string; tier: AutoTier; reason: string } | undefined
  if (nextTier !== undefined) {
    const escalationPick = pickModel(models, nextTier)
    // Never downgrade: escalate only to a strictly stronger model.
    if (escalationPick !== undefined && escalationPick.id !== pick.id && escalationPick.score > pick.score) {
      escalation = {
        id: escalationPick.id,
        tier: nextTier,
        reason: `auto escalation: retry on "${escalationPick.id}" (${nextTier} tier) after a failed foreground run`,
      }
    }
  }
  return { decision, escalation }
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

/**
 * Register the model-facing tools into `ctx.tools`. Returns the disposer that
 * unregisters both, owned by the caller's fiber.
 */
export function registerModelPickerTools(ctx: Context, config: Required<ModelPickerConfig>): () => void {
  const backgroundEnabled = config.enableRunInBackground
  const continuable = config.backgroundMode === 'continuable'
  const maxDepth = typeof config.maxDepth === 'number' ? config.maxDepth : undefined
  const enableAuto = config.enableAuto
  const autoEscalate = config.autoEscalate
  const disposers: Array<() => void> = []

  disposers.push(ctx.tools.register(defineTool({
    name: config.toolName,
    description: 'Delegate a self-contained task to a subagent (a separate agent that works in its own '
      + 'context) and choose the LLM route the child runs on. Unlike the plain subagent tool, the child '
      + 'does not have to inherit this agent\'s model: pass `provider` (an LLM provider route) and `model` '
      + '(a model id that provider accepts) to run the child on any registered model; omitted fields '
      + 'inherit this agent\'s route. Pass `model: "auto"` to delegate model choice to the built-in auto '
      + 'policy: it defaults to this agent\'s own model when one is named (anchored), upgrades to the '
      + 'strongest catalog model only when the task is heavy and the parent model is not a strong one, '
      + 'records the decision with its reason on the result, and retries once on the next tier after a '
      + 'failed foreground run. Query `' + config.modelsToolName + '` for the live provider '
      + 'routes and their model catalogs before choosing. The child returns its result, not its '
      + 'intermediate steps. Give it a complete, standalone prompt: it does not see this conversation.'
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
        description: 'Model id the child runs on (e.g. deepseek-v4-flash), or `"auto"` to let the built-in auto policy choose (requires the llm service): it defaults to this agent\'s own model, upgrading to a stronger catalog model only for heavy tasks on a weak parent model, and records its reason on the result. Defaults to this agent\'s model. Must be a model the chosen provider accepts; query ' + config.modelsToolName + ' for the provider\'s catalog.',
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
              auto: AUTO_SCHEMA,
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'continuable' },
              subagentId: { type: 'string', required: true },
              auto: AUTO_SCHEMA,
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              runId: { type: 'string', required: true },
              output: { type: 'array', required: true, items: { type: 'json' } },
              auto: AUTO_SCHEMA,
            },
          },
        ],
      },
      render: (_args, value) => [{
        type: 'text',
        text: (value.kind === 'background'
          ? `started background subagent task ${value.jobId}`
          : value.kind === 'continuable'
            ? `started subagent ${value.subagentId}`
            : outputValueText(value.output))
          + autoRender(value.auto as AutoDecision | undefined),
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
      let autoSelection: AutoSelection | undefined
      if (args.model === 'auto') {
        if (!enableAuto) {
          throw new Error(`${config.toolName}: model "auto" is disabled on this instance (enableAuto: false)`)
        }
        autoSelection = await resolveAutoSelection(
          ctx,
          args,
          parent.options?.provider,
          parent.options?.model,
          config.toolName,
        )
        agentOptions.provider = autoSelection.decision.provider
        agentOptions.model = autoSelection.decision.model
      } else {
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
      const auto = autoSelection?.decision
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
          return {
            kind: 'continuable',
            subagentId: String(started.childId),
            ...auto !== undefined ? { auto } : {},
          }
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
        return { kind: 'background', jobId: id, ...auto !== undefined ? { auto } : {} }
      }

      const run: SubagentRun = await ctx.subagents.start(config.subagentProvider, {
        ...request,
        signal: exec.signal,
      })
      // Escalation applies only when the run outcome is visible here (foreground)
      // and the policy resolved a strictly stronger model for the next tier.
      if (autoSelection === undefined || autoSelection.escalation === undefined || !autoEscalate) {
        const settled = await settleForegroundRun(run)
        return {
          ...settled,
          ...auto !== undefined ? { auto } : {},
        }
      }
      try {
        const settled = await settleForegroundRun(run)
        return {
          ...settled,
          ...auto !== undefined ? { auto } : {},
        }
      } catch (firstError) {
        if (exec.signal.aborted) throw firstError
        const escalation = autoSelection.escalation
        let retry: SubagentRun
        try {
          retry = await ctx.subagents.start(config.subagentProvider, {
            ...request,
            agentOptions: { ...request.agentOptions, model: escalation.id },
            signal: exec.signal,
          })
        } catch (startError) {
          throw new AggregateError(
            [firstError, startError],
            `${config.toolName}: auto-chosen "${autoSelection.decision.model}" failed and the escalated retry on "${escalation.id}" could not start`,
          )
        }
        try {
          const settled = await settleForegroundRun(retry)
          return {
            ...settled,
            auto: {
              ...autoSelection.decision,
              model: escalation.id,
              tier: escalation.tier,
              escalatedFrom: autoSelection.decision.model,
            },
          }
        } catch (retryError) {
          throw new AggregateError(
            [firstError, retryError],
            `${config.toolName}: auto-chosen "${autoSelection.decision.model}" failed and the escalated retry on "${escalation.id}" also failed`,
          )
        }
      }
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
