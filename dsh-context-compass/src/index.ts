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
import { Config, resolveConfig, validateThresholdLadder, type Config as ConfigType, type ResolvedConfig } from './config.ts'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
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
    // C1 live config source: starts at the composition entry (resolveConfig
    // normalizes for direct-call paths), installSettingsSection repoints it at
    // the settings scope while a settings service is mounted and falls back to
    // the entry when it goes away. All consumers read through source() at USE
    // time — threshold changes reach the badge on the next push frame.
    let source: () => ResolvedConfig = () => resolveConfig(config)
    installSettingsSection(ctx, settingsNamespace('context-compass'), Config, config, {
      setSource: current => { source = () => resolveConfig(current()) },
      onChange: () => syncProjectionUnit(),
      validate: value => validateThresholdLadder(resolveConfig(value)),
    })
    // Stable reader: setSource REASSIGNS `source`, so consumers must capture
    // this wrapper (not the current thunk) to see later assignments.
    const configSource = (): ResolvedConfig => source()
    const resolved = source()

    // Live pricing cache: periodic fetch when priceSource is 'auto',
    // static config otherwise. Provided on the context so assess() and the
    // projection view share one resolved price. C1: the refresh wiring reads
    // cost.priceSource/urls/refreshHours ONCE here — those four fields take
    // effect after a restart (documented in the schema); everything else is live.
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
    // C1: projection.enabled is a registration-level fact — onChange re-judges
    // it (dispose the unit, or register it) instead of requiring a restart.
    let projectionDisposer: (() => void) | null = null
    const syncProjectionUnit = (): void => {
      const want = source().projection.enabled
      if (want && projectionDisposer === null) {
        ctx.inject(['sessionProjections'], (projectionCtx) => {
          if (!source().projection.enabled) return // toggled off while the inject child was pending
          projectionDisposer = projectionCtx.sessionProjections.register(sessionHealthProjectionDefinition(configSource, pricing, modelOf))
        })
      } else if (!want && projectionDisposer !== null) {
        projectionDisposer()
        projectionDisposer = null
      }
    }
    syncProjectionUnit()

    // Model-callable self-check (optional child).
    ctx.inject(['tools'], (toolCtx) => {
      toolCtx.tools.register(sessionHealthTool(toolCtx, configSource))
    })

    // User-initiated report (optional child).
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register(healthCommandDefinition(commandCtx, configSource))
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
        handler: (req: IncomingMessage, res: ServerResponse) => handleOverviewRpc(req, res, wsCtx, configSource),
      })
      ctx.effect(() => () => { try { dispose() } catch { /* ignore */ } })
    })
  },
} satisfies {
  name: string
  Config: typeof Config
  apply(ctx: Context, config?: ConfigType): void
}
