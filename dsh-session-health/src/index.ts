/**
 * dsh-session-health — Host half.
 *
 * One plugin, four surfaces, one shared read-only assessment core:
 * - `ctx.sessionHealth` — Typert Remote service (badge fallback path)
 * - `sessionHealth` projection unit — reactive badge data (no polling)
 * - `session_health` tool — model-callable self-check in long tasks
 * - `/health` command — user-initiated full textual report
 *
 * Data sources (all read-only, all real):
 * - ctx.tokenMeter.measure(session) — exact per-round input pressure
 * - llm.resolveModelInfo — model context window
 * - sessionQuery / sessionProjections — message/turn/compaction counts
 * - fs + sandboxPolicy — optional git / handoff-doc probes
 * - ctx.subprocess — optional read-only process probe
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Session } from '@deepseek-ai/dsh-session'
import { remoteSchemas, HealthStateRequestSchema, HealthStateResultSchema } from './schemas.ts'
import type { HealthStateRequest, HealthStateResult } from './types.ts'
import { Config, resolveConfig, type ResolvedConfig } from './config.ts'
import { applyHealthEvent, healthView, sessionHealthProjectionDefinition, type SessionHealthState } from './projection.ts'
import { assess } from './assess.ts'
import { healthCommandDefinition } from './command.ts'
import { sessionHealthTool } from './tool.ts'

export { Config } from './config.ts'
export { remoteSchemas } from './schemas.ts'
export { sessionHealthProjectionDefinition, applyHealthEvent, healthView } from './projection.ts'
export { assess, type HealthReport, type AssessOptions } from './assess.ts'
export { healthCommandDefinition, buildCommandText } from './command.ts'
export { sessionHealthTool } from './tool.ts'
export type * from './types.ts'

/** Read the current model's context window through the session's route. */
async function resolveWindow(ctx: Context, session: Session): Promise<number | null> {
  const agentDefaultModel = ctx.get('agentDefaultModel')
  const llm = ctx.get('llm')
  if (agentDefaultModel === undefined || llm === undefined) return null
  try {
    const sel = agentDefaultModel.currentSelection()
    const info = await llm.resolveModelInfo(sel.provider, sel.model)
    return info?.context?.contextWindow ?? null
  } catch {
    return null
  }
}

/** Exact per-round input pressure via the token meter (snapshot caliber). */
function measureTokens(ctx: Context, session: Session): number | null {
  const tokenMeter = ctx.get('tokenMeter')
  if (tokenMeter === undefined) return null
  try {
    const m = tokenMeter.measure(session)
    return typeof m === 'object' && m !== null && typeof m.totalTokens === 'number' ? m.totalTokens : null
  } catch {
    return null
  }
}

/** The Remote service the browser badge's fallback path calls. */
export class SessionHealthService extends TypertRemoteService {
  static inject = ['sessions']

  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx, 'sessionHealth')
    this.config = config
  }

  @Remote('healthState')
  async healthState(request: HealthStateRequest): Promise<HealthStateResult> {
    const sessions = this.ctx.get('sessions') as unknown as { get(id: string): Session | undefined } | undefined
    if (sessions === undefined) return { color: 'green', ratio: null, total: null, window: null }
    const session = sessions.get(request.sessionId)
    if (session === undefined) return { color: 'green', ratio: null, total: null, window: null }
    const total = measureTokens(this.ctx, session)
    const window = await resolveWindow(this.ctx, session)
    const state: SessionHealthState = {
      turns: 0,
      lastTurn: null,
      userMessages: 0,
      assistantMessages: 0,
      compactions: 0,
      ...(total !== null ? { pressureTokens: total } : {}),
      ...(window !== null ? { contextWindow: window } : {}),
    }
    const view = healthView(state, this.config)
    return { color: view.severity, ratio: view.ratio, total: view.total, window: view.window }
  }
}

export const name = 'dsh-session-health'

/**
 * Cordis plugin — OBJECT form (never a factory).
 *
 * The loader mounts `module.default` directly through `ctx.plugin()`: a
 * FUNCTION default is treated as the plugin body and invoked as
 * `(ctx, config)`, so a factory that merely RETURNS `{ apply }` is silently
 * ignored — no error, entry shows ACTIVE, apply never runs. The default
 * export must BE the plugin object (knowledge-sqlite hit this exact pitfall
 * on mount; fixed the same way).
 */
export default {
  name,
  Config,
  apply(ctx: Context, config: Config = {}): void {
    const resolved = resolveConfig(config)
    // The Service constructor registers `sessionHealth` on the context
    // (cordis Service semantics); no explicit provide needed.
    new SessionHealthService(ctx, resolved)

    // Reactive badge data (optional child: headless assemblies without the
    // projection registry just lose the push path, not the plugin).
    if (resolved.projection.enabled) {
      ctx.inject(['sessionProjections'], (projectionCtx) => {
        projectionCtx.sessionProjections.register(sessionHealthProjectionDefinition(resolved))
      })
    }

    // Model-callable self-check (optional child).
    ctx.inject(['tools'], (toolCtx) => {
      toolCtx.tools.register(sessionHealthTool(toolCtx, resolved))
    })

    // User-initiated report (optional child).
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register(healthCommandDefinition(commandCtx, resolved))
    })
  },
} satisfies {
  name: string
  Config: typeof Config
  apply(ctx: Context, config?: Config): void
}
