/**
 * dsh-subagent-model-picker — model-chosen subagent delegation.
 *
 * Drives the REAL plugin body on a real `ToolRuntime` + `SubagentRuntime`,
 * with a package-local scripted subagent provider and a faked `llm` route
 * registry, and invokes the registered tools through `ctx.tools.execute`.
 * Continuable background execution is not exercised here: that path is
 * verbatim from the shipped `@deepseek-ai/dsh-tool-subagent` and needs the
 * full agent-loop testkit; only its mount-time capability rejection is
 * covered.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider, SubagentResult, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { CallId } from '@deepseek-ai/dsh-llm'
import plugin from '../src/index.ts'
import type { ModelPickerConfig } from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** A minimal parent Agent passed through to the provider request. */
const fakeAgent = { id: 'parent-1', ctx: undefined } as never

/** Scripted subagent provider that captures every start request. */
class ScriptedProvider implements SubagentProvider {
  readonly inheritsParentContext = false
  readonly capabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  starts: Array<Record<string, unknown>> = []
  reply = 'child says hi'

  constructor(readonly name: string) {}

  start(request: never) {
    this.starts.push(request as unknown as Record<string, unknown>)
    const run: SubagentRun = {
      id: `scripted-${this.name}` as never,
      localAgent: undefined as never,
      result: Promise.resolve({
        output: [{ type: 'text', text: this.reply }],
        stopReason: 'completed',
      } satisfies SubagentResult),
      dispose: async () => {},
    }
    return run
  }
}

/** Minimal fake `llm` route registry (no network, no adapters). */
function fakeLlm(routes: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>) {
  return {
    listProviders() {
      return routes.map(({ id, name }) => ({ id, name }))
    },
    async listModels(provider: string) {
      const route = routes.find(candidate => candidate.id === provider)
      if (route === undefined) throw new Error(`no route "${provider}"`)
      return route.models.map(model => ({ provider, id: model.id, name: model.name }))
    },
  } as never
}

const DEFAULT_ROUTES = [
  { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }] },
  { id: 'pi-ai-cn', name: 'PI AI CN', models: [{ id: 'pi-3-mini', name: 'PI 3 Mini' }] },
]

async function setup(config: ModelPickerConfig = {}, options: {
  routes?: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>
  withLlm?: boolean
  providerName?: string
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  if (options.withLlm !== false) {
    ctx.provide('llm', fakeLlm(options.routes ?? DEFAULT_ROUTES))
  }
  const provider = new ScriptedProvider(options.providerName ?? 'mock')
  ctx.subagents.registerProvider(provider)
  await ctx.plugin(plugin, { subagentProvider: options.providerName ?? 'mock', ...config })
  return { ctx, provider }
}

let callCounter = 0
function callTool(ctx: Context, name: string, args: unknown, agent?: unknown) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent } : {},
  })
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

function propsOf(ctx: Context, name: string): Record<string, unknown> {
  const schema = ctx.tools.schemas().find(candidate => candidate.name === name)
  expect(schema).toBeDefined()
  return (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
}

afterEach(() => {
  callCounter = 0
})

describe('dsh-subagent-model-picker delegation tool', () => {
  it('registers `subagent_model` exposing description/prompt/provider/model/max_tokens/run_in_background', async () => {
    const { ctx } = await setup()
    expect(Object.keys(propsOf(ctx, 'subagent_model')).sort())
      .toEqual(['description', 'max_tokens', 'model', 'prompt', 'provider', 'run_in_background'])
  })

  it('registers the `subagent_models` catalog tool by default and omits it when disabled', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.schemas().some(candidate => candidate.name === 'subagent_models')).toBe(true)
    const { ctx: withoutList } = await setup({ enableModelList: false })
    expect(withoutList.tools.schemas().some(candidate => candidate.name === 'subagent_models')).toBe(false)
  })

  it('uses a configurable tool name', async () => {
    const { ctx } = await setup({ toolName: 'subagent_llm' })
    expect(ctx.tools.schemas().some(candidate => candidate.name === 'subagent_llm')).toBe(true)
    expect(ctx.tools.schemas().some(candidate => candidate.name === 'subagent_model')).toBe(false)
  })

  it('inherits the parent route when provider/model are omitted', async () => {
    const { ctx, provider } = await setup()
    const result = await callTool(ctx, 'subagent_model', { description: 'do a thing', prompt: 'go research X' }, fakeAgent)
    expect(result.isError).toBe(false)
    expect(provider.starts).toHaveLength(1)
    const request = provider.starts[0]!
    expect(request.agentOptions).toEqual({})
    expect(request.parent).toBe(fakeAgent)
    expect(request.maxDepth).toBe(3)
    expect(text(result)).toBe('child says hi')
  })

  it('passes per-call provider/model/max_tokens into agentOptions', async () => {
    const { ctx, provider } = await setup()
    const result = await callTool(ctx, 'subagent_model', {
      description: 'heavy analysis',
      prompt: 'analyze deeply',
      provider: 'pi-ai-cn',
      model: 'pi-3-mini',
      max_tokens: 2048,
    }, fakeAgent)
    expect(result.isError).toBe(false)
    expect(provider.starts[0]!.agentOptions).toEqual({
      provider: 'pi-ai-cn',
      model: 'pi-3-mini',
      maxTokens: 2048,
    })
  })

  it('rejects an unknown provider route with the registered list', async () => {
    const { ctx } = await setup()
    const result = await callTool(ctx, 'subagent_model', {
      description: 'x',
      prompt: 'y',
      provider: 'nope-provider',
    }, fakeAgent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unknown provider "nope-provider"')
    expect(text(result)).toContain('deepseek-official')
    expect(text(result)).toContain('pi-ai-cn')
  })

  it('rejects an unknown provider even when the route list is empty', async () => {
    const { ctx } = await setup({}, { routes: [] })
    const result = await callTool(ctx, 'subagent_model', {
      description: 'x',
      prompt: 'y',
      provider: 'anything',
    }, fakeAgent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('registered provider routes: (none)')
  })

  it('passes an arbitrary model id through (catalogs are advisory)', async () => {
    const { ctx, provider } = await setup()
    const result = await callTool(ctx, 'subagent_model', {
      description: 'x',
      prompt: 'y',
      model: 'deepseek-some-future-model',
    }, fakeAgent)
    expect(result.isError).toBe(false)
    expect(provider.starts[0]!.agentOptions).toEqual({ model: 'deepseek-some-future-model' })
  })

  it('rejects non-positive or non-integer max_tokens', async () => {
    const { ctx } = await setup()
    // 0 and negative values pass schema validation (integer) and are caught
    // by the runtime guard; 1.5 is rejected by the schema itself.
    for (const maxTokens of [0, -5]) {
      const result = await callTool(ctx, 'subagent_model', {
        description: 'x',
        prompt: 'y',
        max_tokens: maxTokens,
      }, fakeAgent)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('max_tokens must be a positive integer')
    }
    const fractional = await callTool(ctx, 'subagent_model', {
      description: 'x',
      prompt: 'y',
      max_tokens: 1.5,
    }, fakeAgent)
    expect(fractional.isError).toBe(true)
    expect(text(fractional)).toContain('invalid arguments')
  })

  it('requires a calling agent', async () => {
    const { ctx } = await setup()
    const result = await callTool(ctx, 'subagent_model', { description: 'x', prompt: 'y' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })

  it('fails loud at mount when the subagent provider lacks the depthLimit capability', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    const provider = new ScriptedProvider('mock')
    ;(provider.capabilities as { depthLimit: boolean }).depthLimit = false
    ctx.subagents.registerProvider(provider)
    let failure: unknown
    try {
      await ctx.plugin(plugin, { subagentProvider: 'mock' })
    } catch (error) {
      failure = error
    }
    expect(String(failure)).toContain('cannot enforce maxDepth')
  })

  it('fails loud at mount for `backgroundMode: continuable` when the provider cannot prepare continuable children', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SubagentRuntime)
    const provider = new ScriptedProvider('mock')
    delete (provider as { prepareContinuable?: unknown }).prepareContinuable
    ctx.subagents.registerProvider(provider)
    let failure: unknown
    try {
      await ctx.plugin(plugin, { subagentProvider: 'mock', backgroundMode: 'continuable' })
    } catch (error) {
      failure = error
    }
    expect(String(failure)).toContain('does not support `backgroundMode: continuable`')
  })
})

describe('dsh-subagent-model-picker catalog tool', () => {
  it('lists every registered provider with its models', async () => {
    const { ctx } = await setup()
    const result = await callTool(ctx, 'subagent_models', {})
    expect(result.isError).toBe(false)
    const value = JSON.parse(text(result)) as {
      providers: Array<{ provider: string; name: string; models: Array<{ id: string; name: string }> }>
    }
    expect(value.providers).toEqual([
      {
        provider: 'deepseek-official',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
      },
      {
        provider: 'pi-ai-cn',
        name: 'PI AI CN',
        models: [{ id: 'pi-3-mini', name: 'PI 3 Mini' }],
      },
    ])
  })

  it('narrows to one provider and reports unknown ones', async () => {
    const { ctx } = await setup()
    const narrowed = await callTool(ctx, 'subagent_models', { provider: 'pi-ai-cn' })
    expect(narrowed.isError).toBe(false)
    expect(JSON.parse(text(narrowed))).toEqual({
      providers: [{ provider: 'pi-ai-cn', name: 'PI AI CN', models: [{ id: 'pi-3-mini', name: 'PI 3 Mini' }] }],
    })
    const unknown = await callTool(ctx, 'subagent_models', { provider: 'ghost' })
    expect(unknown.isError).toBe(false)
    const parsed = JSON.parse(text(unknown)) as { providers: unknown[]; note: string }
    expect(parsed.providers).toEqual([])
    expect(parsed.note).toContain('unknown provider "ghost"')
  })

  it('degrades gracefully when the llm service is absent', async () => {
    const { ctx } = await setup({}, { withLlm: false })
    const result = await callTool(ctx, 'subagent_models', {})
    expect(result.isError).toBe(false)
    expect(JSON.parse(text(result))).toEqual({
      providers: [],
      note: 'llm service unavailable on this harness',
    })
  })
})
