/**
 * dsh-subagent-router — Client half.
 *
 * Renders the plugin's configuration card in the settings Plugins section
 * (`settings.plugin.item`, key `subagent-router`), bound to the host-side
 * settings namespace of the same name. Editing a field writes it to the user
 * layer through the settings scope (`set`/`unset`); the host plugin's
 * `installSettingsSection` re-resolves on `settings/updated`, so a saved edit
 * takes effect on the next `subagent_model` call without a restart.
 *
 * Data flow: the card is a selector over the shared settings describe mirror
 * (`ctx.settingsScope.bind`). No host RPC, no polling — the scope pushes
 * snapshot replacements on committed document changes.
 */
import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the plugin configuration section (key = settings namespace). */
    'settings.plugin.item': {
      kind: 'keyed'
      scope: 'root'
      owner: { children?: never }
    }
  }
}

/** Serialized config shape the host namespace resolves (mirrors src/config.ts). */
type Section = {
  subagentProvider?: string
  toolName?: string
  modelsToolName?: string
  enableRunInBackground?: boolean
  backgroundMode?: 'one-shot' | 'continuable'
  enableModelList?: boolean
  enableAuto?: boolean
  autoEscalate?: boolean
  autoReroute?: boolean
  autoEscalationTiers?: number
  autoProviderOrder?: string[]
  autoTierPolicy?: Partial<Record<'trivial' | 'standard' | 'complex', 'anchor' | 'cheapest' | 'strongest'>>
  autoTierPicks?: Partial<Record<'trivial' | 'standard' | 'complex', string[]>>
  autoCeiling?: string
  maxDepth?: number | 'provider-managed'
}

const CSS = `
.sr-card{display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-3,#353638);border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:12px;box-sizing:border-box;width:100%;overflow:hidden}
.sr-card.sr-open{background:var(--dsw-alias-bg-layer-3,#353638)}
.sr-header{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:14px 16px;background:transparent;border:none;cursor:pointer;color:var(--dsw-alias-label-primary,#f9fafb);text-align:left;font:inherit}
.sr-header:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,0.06))}
.sr-headText{display:flex;flex-direction:column;gap:2px;min-width:0}
.sr-name{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#f9fafb)}
.sr-description{font-size:12px;color:var(--dsw-alias-label-secondary,#bbb)}
.sr-chevron{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-tertiary,#999);transition:transform .15s ease;transform:rotate(0deg)}
.sr-open .sr-chevron{transform:rotate(90deg)}
.sr-body{display:none;padding:12px 16px 16px;border-top:1px solid var(--dsw-alias-border-l2,#ffffff1f)}
.sr-open .sr-body{display:flex;flex-direction:column;gap:12px}
.sr-field{display:flex;flex-direction:column;gap:4px}
.sr-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#f9fafb)}
.sr-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}
.sr-control{display:flex;align-items:center;gap:8px}
.sr-input{flex:1;min-width:0;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2,#333);border-radius:6px;background:var(--dsw-alias-bg-raised,#1e1e1e);color:var(--dsw-alias-label-primary,#f9fafb);font-size:12px}
.sr-input:focus{outline:2px solid var(--dsw-alias-state-primary,#4c8dff);outline-offset:1px}
.sr-check{accent-color:var(--dsw-alias-state-primary,#4c8dff)}
.sr-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sr-note{font-size:11px;color:var(--dsw-alias-label-tertiary,#999)}
.sr-unavailable{font-size:12px;color:var(--dsw-alias-label-tertiary,#999);padding:14px 16px}
`

/** One typed field: id, label, kind, and the render control's value type. */
type Field =
  | { id: keyof Section; label: string; hint?: string; kind: 'text'; get: (s: Section) => string | undefined; set: (s: Section, v: string) => Section }
  | { id: keyof Section; label: string; hint?: string; kind: 'number'; get: (s: Section) => number | undefined; set: (s: Section, v: number) => Section }
  | { id: keyof Section; label: string; hint?: string; kind: 'boolean'; get: (s: Section) => boolean | undefined; set: (s: Section, v: boolean) => Section }
  | { id: keyof Section; label: string; hint?: string; kind: 'enum'; options: string[]; get: (s: Section) => string | undefined; set: (s: Section, v: string) => Section }
  | { id: keyof Section; label: string; hint?: string; kind: 'array'; get: (s: Section) => string[] | undefined; set: (s: Section, v: string[]) => Section }

/** Declarative field list — single source for the form (mirrors src/config.ts). */
const FIELDS: Field[] = [
  { id: 'subagentProvider', label: 'Subagent provider', hint: 'ctx.subagents provider that starts children (default spawn).', kind: 'text', get: s => s.subagentProvider, set: (s, v) => ({ ...s, subagentProvider: v }) },
  { id: 'toolName', label: 'Delegation tool name', hint: 'Model-facing tool (default subagent_model).', kind: 'text', get: s => s.toolName, set: (s, v) => ({ ...s, toolName: v }) },
  { id: 'modelsToolName', label: 'Catalog tool name', hint: 'Model-facing catalog (default subagent_models).', kind: 'text', get: s => s.modelsToolName, set: (s, v) => ({ ...s, modelsToolName: v }) },
  { id: 'enableRunInBackground', label: 'Enable run_in_background', hint: 'Expose the run_in_background argument.', kind: 'boolean', get: s => s.enableRunInBackground, set: (s, v) => ({ ...s, enableRunInBackground: v }) },
  { id: 'backgroundMode', label: 'Background mode', hint: 'one-shot waits; continuable returns a durable child id.', kind: 'enum', options: ['one-shot', 'continuable'], get: s => s.backgroundMode, set: (s, v) => ({ ...s, backgroundMode: v as 'one-shot' | 'continuable' }) },
  { id: 'enableModelList', label: 'Enable catalog tool', hint: 'Register subagent_models.', kind: 'boolean', get: s => s.enableModelList, set: (s, v) => ({ ...s, enableModelList: v }) },
  { id: 'enableAuto', label: 'Enable model: "auto"', hint: 'Accept model: "auto" on the delegation tool.', kind: 'boolean', get: s => s.enableAuto, set: (s, v) => ({ ...s, enableAuto: v }) },
  { id: 'autoEscalate', label: 'Escalate on failure', hint: 'Retry on the next auto tier after a failed run.', kind: 'boolean', get: s => s.autoEscalate, set: (s, v) => ({ ...s, autoEscalate: v }) },
  { id: 'autoReroute', label: 'Reroute on terminal failure', hint: 'Switch provider on quota/auth failures.', kind: 'boolean', get: s => s.autoReroute, set: (s, v) => ({ ...s, autoReroute: v }) },
  { id: 'autoEscalationTiers', label: 'Escalation tiers', hint: 'Max upgrade steps on one provider (0 disables).', kind: 'number', get: s => s.autoEscalationTiers, set: (s, v) => ({ ...s, autoEscalationTiers: v }) },
  { id: 'autoProviderOrder', label: 'Provider priority', hint: 'Comma-separated provider route ids, highest priority first.', kind: 'array', get: s => s.autoProviderOrder, set: (s, v) => ({ ...s, autoProviderOrder: v }) },
  { id: 'autoCeiling', label: 'Budget ceiling', hint: 'Never pick a model stronger than this id.', kind: 'text', get: s => s.autoCeiling, set: (s, v) => ({ ...s, autoCeiling: v }) },
  { id: 'maxDepth', label: 'Max depth', hint: 'Child depth cap; provider-managed for no cap.', kind: 'enum', options: ['3', '4', '5', 'provider-managed'], get: s => s.maxDepth === undefined ? undefined : String(s.maxDepth), set: (s, v) => ({ ...s, maxDepth: v === 'provider-managed' ? 'provider-managed' : Number(v) }) },
]

const TIER_LABELS: Array<['trivial' | 'standard' | 'complex', string]> = [
  ['trivial', 'Trivial'],
  ['standard', 'Standard'],
  ['complex', 'Complex'],
]
const MODE_OPTIONS = ['anchor', 'cheapest', 'strongest']

/** Render one control for a field, wired to the scope write path. */
function FieldControl(props: {
  field: Field
  value: Section
  scope: SettingsScope<Section>
  disabled: boolean
}): React.ReactElement {
  const { field, value, scope, disabled } = props
  const commit = (patch: Section): void => {
    for (const key of Object.keys(patch) as Array<keyof Section>) {
      const next = patch[key]
      if (next === undefined || next === '') {
        void scope.unset(key as string)
      } else {
        void scope.set(key as string, next as unknown)
      }
    }
  }
  const hint = field.hint === undefined ? null : React.createElement('div', { className: 'sr-hint' }, field.hint)
  switch (field.kind) {
    case 'text': {
      const current = field.get(value) ?? ''
      return React.createElement('div', { className: 'sr-field' },
        React.createElement('label', { className: 'sr-label', htmlFor: `sr-${String(field.id)}` }, field.label),
        React.createElement('div', { className: 'sr-control' },
          React.createElement('input', {
            id: `sr-${String(field.id)}`,
            className: 'sr-input',
            value: current,
            disabled,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => commit(field.set(value, e.target.value)),
          }),
        ),
        hint,
      )
    }
    case 'number': {
      const current = field.get(value)
      return React.createElement('div', { className: 'sr-field' },
        React.createElement('label', { className: 'sr-label', htmlFor: `sr-${String(field.id)}` }, field.label),
        React.createElement('div', { className: 'sr-control' },
          React.createElement('input', {
            id: `sr-${String(field.id)}`,
            className: 'sr-input',
            type: 'number',
            value: current === undefined ? '' : String(current),
            disabled,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) commit(field.set(value, n))
            },
          }),
        ),
        hint,
      )
    }
    case 'boolean': {
      const current = field.get(value) ?? false
      return React.createElement('div', { className: 'sr-row' },
        React.createElement('label', { className: 'sr-label', htmlFor: `sr-${String(field.id)}` }, field.label),
        React.createElement('div', { className: 'sr-control' },
          React.createElement('input', {
            id: `sr-${String(field.id)}`,
            className: 'sr-check',
            type: 'checkbox',
            checked: current,
            disabled,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => commit(field.set(value, e.target.checked)),
          }),
          hint,
        ),
      )
    }
    case 'enum': {
      const current = field.get(value) ?? ''
      return React.createElement('div', { className: 'sr-field' },
        React.createElement('label', { className: 'sr-label', htmlFor: `sr-${String(field.id)}` }, field.label),
        React.createElement('div', { className: 'sr-control' },
          React.createElement('select', {
            id: `sr-${String(field.id)}`,
            className: 'sr-input',
            value: current,
            disabled,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => commit(field.set(value, e.target.value)),
          }, field.options.map(option =>
            React.createElement('option', { key: option, value: option }, option))),
        ),
        hint,
      )
    }
    case 'array': {
      const current = (field.get(value) ?? []).join(', ')
      return React.createElement('div', { className: 'sr-field' },
        React.createElement('label', { className: 'sr-label', htmlFor: `sr-${String(field.id)}` }, field.label),
        React.createElement('div', { className: 'sr-control' },
          React.createElement('input', {
            id: `sr-${String(field.id)}`,
            className: 'sr-input',
            value: current,
            disabled,
            placeholder: 'a, b, c',
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => commit(
              field.set(value, e.target.value.split(',').map(part => part.trim()).filter(Boolean)),
            ),
          }),
        ),
        hint,
      )
    }
  }
}

/** The settings Plugins-section card for dsh-subagent-router. */
function SettingsCard(props: { scope: SettingsScope<Section> }): React.ReactElement {
  const { scope } = props
  const [snapshot, setSnapshot] = React.useState<SettingsScopeSnapshot<Section>>(scope.getSnapshot())
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope])
  const value = snapshot.value ?? ({} as Section)
  const disabled = !snapshot.writable || snapshot.status !== 'ready'
  if (snapshot.status === 'unavailable') {
    return React.createElement('div', { className: 'sr-card' },
      React.createElement('style', null, CSS),
      React.createElement('div', { className: 'sr-unavailable' },
        'subagent-router: settings namespace unavailable on this deployment.'),
    )
  }
  const chevron = React.createElement('svg', {
    className: 'sr-chevron',
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true,
  },
    React.createElement('path', {
      d: 'M6 4l4 4-4 4',
      stroke: 'currentColor',
      strokeWidth: '1.5',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
  return React.createElement('div', {
    className: open ? 'sr-card sr-open' : 'sr-card',
  },
    React.createElement('style', null, CSS),
    React.createElement('button', {
      className: 'sr-header',
      type: 'button',
      'aria-expanded': open,
      onClick: () => setOpen(!open),
    },
      React.createElement('span', { className: 'sr-headText' },
        React.createElement('span', { className: 'sr-name' }, 'dsh-subagent-router'),
        React.createElement('span', { className: 'sr-description' },
          'Model-routed subagent delegation. Model choice per call (auto policy, health-aware rerouting).'),
      ),
      chevron,
    ),
    React.createElement('div', { className: 'sr-body' },
      React.createElement('div', { className: 'sr-note' },
        'Edits take effect on the next subagent_model call (no restart).'),
      ...FIELDS.map(field => React.createElement(FieldControl, { key: String(field.id), field, value, scope, disabled })),
      ...TIER_LABELS.map(([tier, label]) => {
        const current = value.autoTierPolicy?.[tier] ?? ''
        return React.createElement('div', { className: 'sr-field', key: `tier-${tier}` },
          React.createElement('label', { className: 'sr-label', htmlFor: `sr-tier-${tier}` }, `Tier ${label} policy`),
          React.createElement('div', { className: 'sr-control' },
            React.createElement('select', {
              id: `sr-tier-${tier}`,
              className: 'sr-input',
              value: current,
              disabled,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                // `set` writes whole top-level fields; merge the tier edit into
                // the existing autoTierPolicy object and write it as one value.
                const next = { ...(value.autoTierPolicy ?? {}), [tier]: e.target.value }
                void scope.set('autoTierPolicy', next)
              },
            }, MODE_OPTIONS.map(option =>
              React.createElement('option', { key: option, value: option }, option))),
          ),
          React.createElement('div', { className: 'sr-hint' },
            `${label} task selection mode (empty = built-in heuristic).`),
        )
      }),
    ),
  )
}

export const name = 'dsh-subagent-router'

export const inject = ['slots', 'settingsScope']

/** Client entry: register the settings Plugins-section card for the namespace. */
export function apply(ctx: ClientContext): void {
  // `settingsScope` is a runtime Service provided by dsh-client-ui-settings
  // (no compile-time Context enhancement ships with it — assert the shape).
  const settingsScope = (ctx as unknown as {
    settingsScope: { bind(spec: { namespace: string }): SettingsScope<Section> }
  }).settingsScope
  const scope = settingsScope.bind({ namespace: 'subagent-router' })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
    { name: 'settings.plugin.item', key: 'subagent-router' } as never,
    () => React.createElement(SettingsCard, { scope }),
  ) as never)
}
