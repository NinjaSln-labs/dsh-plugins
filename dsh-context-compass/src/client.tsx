/**
 * dsh-context-compass — Client half.
 *
 * Entry point: registers the session-health badge, the /compass rich card,
 * and the multi-session overview panel seats. The implementation lives in
 * ./client/{styles,shared,badge,command-card,overview} — this file only wires
 * them into the four slots.
 *
 * Data flow: PURE projection push. The badge subscribes to the host-computed
 * `sessionHealth` projection (`sessions.binding(...).session.projections
 * .faceOf('sessionHealth')`), updated by `session/projection` frames the
 * moment the host fold changes — zero polling, zero RPC. The projection seam
 * is the one wire path community plugins own: the browser mounts a fixed,
 * build-time generated Remote list (api-remotes), so a plugin Remote such as
 * `remote.sessionHealth` can never mount — inject it and the entry stays
 * pending forever (web boot: waiting for service: remote.sessionHealth).
 *
 * Clicking the badge runs `/compass` through the core commands Remote
 * (`remote.commands`, always mounted) for the full textual report.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the header.utilities seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the two seats below live in OTHER ui packages (ui-sidebar
// declares sidebar.footer.action, ui-layout declares shell.overlay) that are
// not on this plugin's type resolution path. The runtime slot tree was
// verified via the harness Inspect provider; this local augmentation mirrors
// the owner-prop contracts from those packages' d.ts files (compile-time only
// — erased from the bundle; slots.inject on a runtime-missing key is inert).
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Owner share of one action beside Settings at the sidebar foot. */
    'sidebar.footer.action': {
      kind: 'list'
      scope: 'root'
      owner: { wide: boolean }
    }
    /** Frame-wide floating layer (list slot, no owner props). */
    'shell.overlay': {
      kind: 'list'
      scope: 'root'
    }
  }
}
import { injectStyles } from './client/styles.ts'
import { HealthBadge } from './client/badge.tsx'
import { CompassCommandCard } from './client/command-card.tsx'
import { OverviewAction, OverviewPanel, OverviewStore } from './client/overview.tsx'
import type { ProjectionFace, CommandsRemote } from './client/shared.ts'
// Re-export the report parser + pressure helpers — the client-mount test
// asserts them on the entry module (the pre-split client.tsx exported them).
export { parseCompassReport, mergePressure, lagOf, type CompassReport, type ContextPressureLike } from './client/shared.ts'

/** Package id — must match package.json `name` and the ModuleLoader handoff. */
export const name = 'dsh-context-compass'

/**
 * Required client services. Cordis forbids `ctx.remote` / `ctx.sessions` /
 * `ctx.slots` property reads unless they appear here (topology-sensitive
 * proxy; "cannot get property X without inject"). Both the `remote` root and
 * the `remote.commands` sub-service are injected, mirroring the in-tree
 * convention (ui-goal: ['slots','sessions','remote','remote.goals',...]).
 * There is deliberately NO `remote.sessionHealth`: plugin Remotes never mount
 * client-side, and an injected one would leave the entry pending forever.
 */
export const inject = ['slots', 'sessions', 'remote', 'remote.commands', 'locale']

/** Client entry: register the badge + the multi-session overview panel seats. */
export function apply(ctx: ClientContext): void {
  injectStyles()

  const sessions = ctx.sessions as unknown as {
    binding(sessionId: string): { session: { projections: { faceOf(key: string): ProjectionFace | undefined } } } | undefined
    open(id: string): void
    /** Session-list store: byId rows carry `updatedAt` (last activity, epoch ms). */
    list: { getSnapshot(): { byId: Record<string, { updatedAt?: number }> } }
  }
  const commands = (ctx.remote as unknown as { commands: CommandsRemote }).commands
  const locale = (ctx as unknown as { locale: { snapshot: { active: string } } }).locale

  // Multi-session overview: the sidebar-foot opener and the frame overlay
  // share one open-state store created per apply (disposed with the fiber —
  // a re-apply starts fresh, an unload takes the registrations with it).
  const overviewStore = new OverviewStore()

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
    { name: 'conversation.session.header.utilities', id: 'session-health-dot', order: 10 } as never,
    (props: { sessionId: string }) => (
      <HealthBadge
        sessionId={props.sessionId}
        sessions={sessions}
        commands={commands}
        locale={locale}
      />
    ),
  ) as never)

  // /compass rich card: the commandview seat dispatches by command name and
  // is currently unoccupied — registering 'compass' upgrades the row.
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register(
    { name: 'conversation.chat.commandview', key: 'compass' } as never,
    (props: { node: never }) => <CompassCommandCard node={props.node} />,
  ) as never)

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'session-health-overview', order: 10 } as never,
    (props: { wide: boolean }) => (
      <OverviewAction wide={props.wide} store={overviewStore} />
    ),
  ) as never)
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'session-health-overview-panel', order: 10 } as never,
    () => (
      <OverviewPanel
        store={overviewStore}
        sessions={sessions}
        commands={commands}
        locale={locale}
      />
    ),
  ) as never)
}
