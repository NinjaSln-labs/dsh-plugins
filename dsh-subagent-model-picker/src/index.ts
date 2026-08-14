/**
 * dsh-subagent-model-picker — model-chosen subagent delegation for DeepSeek Harness.
 *
 * The shipped `subagent` tool inherits the parent's model route (or a static
 * `agentOptions` in the composition row). This plugin registers a sibling tool
 * (`subagent_model`, name configurable) that lets the delegating model pick the
 * child's LLM provider route, model id, and output cap per call:
 *
 *   - `provider`  — an LLM provider route registered on `ctx.llm` (hard-validated
 *                   against `ctx.llm.listProviders()`; omitted → inherit parent).
 *   - `model`     — any model id the chosen provider accepts (passed through:
 *                   the harness treats catalogs as advisory — the DeepSeek
 *                   adapter accepts arbitrary ids, pi-ai validates configured
 *                   ones — so the provider itself owns model rejection).
 *   - `max_tokens`— per-child output cap (positive integer).
 *
 * The child still runs through the ordinary `ctx.subagents` seam
 * (`resolveChildAgentOptions` merges per-child overrides over the parent's
 * route), so spawn/fork/in-process composition, depth accounting, delegation
 * policy, and continuable background children all behave exactly as they do
 * for the shipped tool. A companion read-only `subagent_models` tool lists the
 * live provider routes and their model catalogs so the model can make an
 * informed choice.
 *
 * 组合位置：host 平面（与 tool-subagent 相同 —— 它消费 host 的 `tools` /
 * `subagents` / `llm` 注册表，不发布服务，因此无需 isolate realm）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { assertSubagentMaxDepth } from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { registerModelPickerTools } from './tools.ts'

/** Prompt order after bounded delegation policy and before child reporting. */
const SUBAGENT_SECTION_ORDER = 116.5

/** Plugin config; every field optional with a sane default. */
export interface ModelPickerConfig {
  /** The `ctx.subagents` provider name to start runs on (default `spawn`). */
  subagentProvider?: string
  /** Model-facing delegation tool name (default `subagent_model`). */
  toolName?: string
  /** Model-facing catalog tool name (default `subagent_models`). */
  modelsToolName?: string
  /** Expose `run_in_background` on the delegation tool (default true). */
  enableRunInBackground?: boolean
  /** Background policy (default `one-shot`); `continuable` needs the provider's `prepareContinuable`. */
  backgroundMode?: 'one-shot' | 'continuable'
  /** Register the `subagent_models` catalog tool (default true). */
  enableModelList?: boolean
  /** Child depth cap (default 3; `'provider-managed'` sends no cap). */
  maxDepth?: number | 'provider-managed'
}

export const name = 'dsh-subagent-model-picker'
export const inject = ['tools', 'subagents', 'systemPrompt']

export const defaultConfig = {
  subagentProvider: 'spawn',
  toolName: 'subagent_model',
  modelsToolName: 'subagent_models',
  enableRunInBackground: true,
  backgroundMode: 'one-shot',
  enableModelList: true,
  maxDepth: 3,
} satisfies Required<ModelPickerConfig>

export function resolveConfig(config: ModelPickerConfig): Required<ModelPickerConfig> {
  return {
    subagentProvider: config.subagentProvider ?? defaultConfig.subagentProvider,
    toolName: config.toolName ?? defaultConfig.toolName,
    modelsToolName: config.modelsToolName ?? defaultConfig.modelsToolName,
    enableRunInBackground: config.enableRunInBackground ?? defaultConfig.enableRunInBackground,
    backgroundMode: config.backgroundMode ?? defaultConfig.backgroundMode,
    enableModelList: config.enableModelList ?? defaultConfig.enableModelList,
    maxDepth: config.maxDepth ?? defaultConfig.maxDepth,
  }
}

export function apply(ctx: Context, config: ModelPickerConfig = {}): void {
  const resolved = resolveConfig(config)
  // Direct apply() bypasses any schema defaults; validate here like the
  // shipped tool does.
  if (resolved.maxDepth !== 'provider-managed') assertSubagentMaxDepth(resolved.maxDepth)
  const backgroundEnabled = resolved.enableRunInBackground
  const continuable = resolved.backgroundMode === 'continuable'

  // Mirror provider lifecycle: sibling load order and HMR replacement can
  // change provider availability while this fiber stays active.
  let disposeTools: (() => void) | undefined
  const mount = (provider: SubagentProvider): void => {
    // A numeric cap the provider cannot enforce is a misconfiguration — fail
    // at mount (the earliest point capabilities are known), not on delegation.
    if (typeof resolved.maxDepth === 'number' && !provider.capabilities.depthLimit) {
      throw new Error(
        `dsh-subagent-model-picker: provider "${provider.name}" cannot enforce maxDepth `
        + `(no depthLimit capability) — set maxDepth: 'provider-managed' to leave the recursion `
        + 'budget to the provider',
      )
    }
    if (continuable && provider.prepareContinuable === undefined) {
      throw new Error(
        `dsh-subagent-model-picker: provider "${provider.name}" does not support `
        + '`backgroundMode: continuable`',
      )
    }
    disposeTools = registerModelPickerTools(ctx, resolved)
  }

  ctx.on('subagent/provider-added', (provider) => {
    if (provider.name === resolved.subagentProvider && disposeTools === undefined) mount(provider)
  })
  ctx.on('subagent/provider-removed', (name) => {
    if (name !== resolved.subagentProvider || disposeTools === undefined) return
    disposeTools()
    disposeTools = undefined
  })
  const present = ctx.subagents.getProvider(resolved.subagentProvider)
  if (present !== undefined) {
    mount(present)
  } else {
    ctx.logger.info(
      `dsh-subagent-model-picker: subagent provider "${resolved.subagentProvider}" not registered yet; `
      + `the "${resolved.toolName}" tool will register when it appears`,
    )
  }

  if (backgroundEnabled && continuable) {
    // The section follows provider availability without its own manual
    // lifecycle: empty text is omitted while the tool is absent.
    ctx.systemPrompt.section({
      name: `tool:${resolved.toolName}`,
      order: SUBAGENT_SECTION_ORDER,
      text: context => disposeTools === undefined || ctx.tools.get(resolved.toolName, context.scope) === undefined
        ? ''
        : `Use ${resolved.toolName} in the background by default. Start independent delegations together in one assistant message and continue useful work while they run. Set \`run_in_background: false\` only when your next action depends on that subagent's result. When a background run settles, the runtime sends you a notice containing its outcome and any final assistant message.`,
    })
  }
}

export default {
  name,
  inject,
  apply,
}
