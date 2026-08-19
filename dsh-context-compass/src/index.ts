/**
 * dsh-context-compass — Host half.
 *
 * One plugin, three surfaces, one shared read-only assessment core:
 * - `sessionHealth` projection unit — reactive badge data (push frames, no
 *   polling, no Remote: community plugins cannot expose a Remote to the
 *   browser client — the client mounts a fixed generated list, see schemas.ts)
 * - `context_compass` tool — model-callable self-check in long tasks
 * - `/compass` command — user-initiated full textual report
 *
 * Data sources (all read-only, all real):
 * - ctx.tokenMeter.measure(session) — exact per-round input pressure
 * - llm.resolveModelInfo — model context window
 * - sessionQuery / sessionProjections — message/turn/compaction counts
 * - fs + sandboxPolicy — optional git / handoff-doc probes
 * - ctx.subprocess — optional read-only process probe
 */
import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Config, resolveConfig, type Config as ConfigType } from './config.ts'
import { sessionHealthProjectionDefinition } from './projection.ts'
import { healthCommandDefinition } from './command.ts'
import { sessionHealthTool } from './tool.ts'
import { PriceCache, startPricingRefresh, staticPricing } from './pricing.ts'
import { handleOverviewRpc } from './overview.ts'

export { Config } from './config.ts'
export { sessionHealthProjectionDefinition, applyHealthEvent, healthView } from './projection.ts'
export { assess, type HealthReport, type AssessOptions } from './assess.ts'
export { healthCommandDefinition, buildCommandText } from './command.ts'
export { buildSnapshotText, probeCrossSession, KNOWLEDGE_SNAPSHOT_KEY } from './knowledge.ts'
export { sessionHealthTool } from './tool.ts'
export { buildOverview, sortOverviewRows, rankOf, clearTitleCache, handleOverviewRpc, buildHandoffSummary, type OverviewRow } from './overview.ts'
export type * from './types.ts'

export const name = 'dsh-context-compass'

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
  apply(ctx: Context, config: ConfigType = {}): void {
    const resolved = resolveConfig(config)

    // Live pricing cache: periodic fetch when priceSource is 'auto',
    // static config otherwise. Provided on the context so assess() and the
    // projection view share one resolved price.
    const pricing = new PriceCache(staticPricing(resolved.cost.inputPricePerM, resolved.cost.cacheHitDiscount))
    ctx.provide('sessionHealthPricing', pricing)
    startPricingRefresh(ctx, resolved.cost, pricing)
    // Current model name for per-model prices ('' falls back to the doc's "*").
    const modelOf = (): string => {
      try {
        const sel = (ctx.get('agentDefaultModel') as { currentSelection(): { model: string } } | undefined)?.currentSelection()
        return sel?.model ?? ''
      } catch {
        return ''
      }
    }

    // Reactive badge data (optional child: headless assemblies without the
    // projection registry just lose the push path, not the plugin).
    if (resolved.projection.enabled) {
      ctx.inject(['sessionProjections'], (projectionCtx) => {
        projectionCtx.sessionProjections.register(sessionHealthProjectionDefinition(resolved, pricing, modelOf))
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

    // Multi-session overview panel data (optional child): same-origin RPC
    // route for the browser panel — bundle clients cannot mount a plugin
    // Remote, so browser↔host calls ride the webServer seam (imgdraw pattern).
    // ctx.inject waits for the service: bundles apply before webServer
    // activates at boot and ctx.get would silently return undefined.
    ctx.inject(['webServer'], (wsCtx) => {
      const webServer = (wsCtx as unknown as {
        webServer: { register(route: unknown): () => void }
      }).webServer
      const dispose = webServer.register({
        kind: 'exact',
        path: '/context-compass-rpc',
        handler: (req: IncomingMessage, res: ServerResponse) => handleOverviewRpc(req, res, wsCtx, resolved),
      })
      ctx.effect(() => () => { try { dispose() } catch { /* ignore */ } })
    })
  },
} satisfies {
  name: string
  Config: typeof Config
  apply(ctx: Context, config?: ConfigType): void
}
