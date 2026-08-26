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

// Side-effect type import: pulls the augmented module into the program so the
// `declare module` below can merge into its SlotMap interface. Under
// `skipLibCheck` TS does not chase the .d.ts imports that reference this
// module (e.g. dsh-client-runtime's slots types), so without this import the
// augmentation fails with TS2664 "module cannot be found" in a clean install.
// Type-only -> erased at bundle time; ui-slots stays external at runtime.
import type {} from '@deepseek-ai/dsh-client-ui-slots'

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
.sr-header{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:14px 16px;background:transparent;border:none;cursor:pointer;color:var(--dsw-alias-label-primary,#f9fafb);text-align:left;font:inherit}
.sr-header:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,0.06))}
.sr-headText{display:flex;flex-direction:column;gap:2px;min-width:0}
.sr-name{font-size:15px;font-weight:600;line-height:21px;color:var(--dsw-alias-label-primary,#f9fafb)}
.sr-description{font-size:13px;font-weight:400;line-height:19.5px;color:var(--dsw-alias-label-secondary,#adb2b8)}
.sr-chevron{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-tertiary,#999);transition:transform .15s ease;transform:rotate(0deg)}
.sr-open .sr-chevron{transform:rotate(90deg)}
.sr-body{display:none;padding:0 0 8px;border-top:1px solid var(--dsw-alias-border-l2,#ffffff1f)}
.sr-open .sr-body{display:flex;flex-direction:column;padding:12px 16px 8px}
.sr-field{display:flex;flex-direction:column;gap:4px}
.sr-label{font-size:13px;font-weight:500;line-height:19.5px;color:var(--dsw-alias-label-primary,#f9fafb)}
.sr-hint{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary,#adb2b8)}
.sr-control{display:flex;align-items:center;gap:8px}
.sr-input{flex:1;min-width:0;height:32px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#353638);color:var(--dsw-alias-label-primary,#f9fafb);font-size:13px;font-weight:400;box-sizing:border-box}
.sr-input:focus{outline:2px solid var(--dsw-alias-state-primary,#4c8dff);outline-offset:1px}
.sr-check{accent-color:var(--dsw-alias-state-primary,#4c8dff)}
.sr-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sr-note{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary,#adb2b8)}
.sr-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.sr-btn{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 14px;border-radius:8px;font-size:13px;font-weight:400;line-height:19.5px;cursor:pointer;box-sizing:border-box;transition:background .12s ease}
.sr-btn:disabled{opacity:.45;cursor:not-allowed}
.sr-btn-default{background:transparent;border:1px solid var(--dsw-alias-border-l2,#ffffff1f);color:var(--dsw-alias-label-secondary,#cfd3d6)}
.sr-btn-default:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,0.06))}
.sr-btn-primary{background:var(--dsw-alias-label-primary,#f9fafb);border:1px solid transparent;color:var(--dsw-alias-bg-layer-3,#353638)}
.sr-btn-primary:hover:not(:disabled){filter:brightness(0.92)}
.sr-unavailable{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary,#adb2b8);padding:14px 16px}
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
  { id: 'subagentProvider', label: '子代理提供方', hint: '启动子代理的 ctx.subagents 提供方（默认 spawn）。', kind: 'text', get: s => s.subagentProvider, set: (s, v) => ({ ...s, subagentProvider: v }) },
  { id: 'toolName', label: '委派工具名', hint: '面向模型的委派工具（默认 subagent_model）。', kind: 'text', get: s => s.toolName, set: (s, v) => ({ ...s, toolName: v }) },
  { id: 'modelsToolName', label: '目录工具名', hint: '面向模型的目录工具（默认 subagent_models）。', kind: 'text', get: s => s.modelsToolName, set: (s, v) => ({ ...s, modelsToolName: v }) },
  { id: 'enableRunInBackground', label: '启用 run_in_background', hint: '暴露 run_in_background 参数。', kind: 'boolean', get: s => s.enableRunInBackground, set: (s, v) => ({ ...s, enableRunInBackground: v }) },
  { id: 'backgroundMode', label: '后台模式', hint: 'one-shot 前台等待；continuable 返回持久子代理 id。', kind: 'enum', options: ['one-shot', 'continuable'], get: s => s.backgroundMode, set: (s, v) => ({ ...s, backgroundMode: v as 'one-shot' | 'continuable' }) },
  { id: 'enableModelList', label: '启用目录工具', hint: '注册 subagent_models。', kind: 'boolean', get: s => s.enableModelList, set: (s, v) => ({ ...s, enableModelList: v }) },
  { id: 'enableAuto', label: '启用 model: "auto"', hint: '委派工具接受 model: "auto"。', kind: 'boolean', get: s => s.enableAuto, set: (s, v) => ({ ...s, enableAuto: v }) },
  { id: 'autoEscalate', label: '失败时升级', hint: '运行失败后沿下一档自动重试。', kind: 'boolean', get: s => s.autoEscalate, set: (s, v) => ({ ...s, autoEscalate: v }) },
  { id: 'autoReroute', label: '终态失败换路', hint: '配额/鉴权失败时切换到健康提供方。', kind: 'boolean', get: s => s.autoReroute, set: (s, v) => ({ ...s, autoReroute: v }) },
  { id: 'autoEscalationTiers', label: '升级档数上限', hint: '同一提供方最多升级几步（0 表示不升级）。', kind: 'number', get: s => s.autoEscalationTiers, set: (s, v) => ({ ...s, autoEscalationTiers: v }) },
  { id: 'autoProviderOrder', label: '提供方优先级', hint: '逗号分隔的提供方路由 id，优先的在前。', kind: 'array', get: s => s.autoProviderOrder, set: (s, v) => ({ ...s, autoProviderOrder: v }) },
  { id: 'autoCeiling', label: '预算封顶', hint: '绝不选择比该模型更强的模型。', kind: 'text', get: s => s.autoCeiling, set: (s, v) => ({ ...s, autoCeiling: v }) },
  { id: 'maxDepth', label: '最大深度', hint: '子代理深度上限；provider-managed 表示不设限。', kind: 'enum', options: ['3', '4', '5', 'provider-managed'], get: s => s.maxDepth === undefined ? undefined : String(s.maxDepth), set: (s, v) => ({ ...s, maxDepth: v === 'provider-managed' ? 'provider-managed' : Number(v) }) },
]

const TIER_LABELS: Array<['trivial' | 'standard' | 'complex', string]> = [
  ['trivial', '琐碎'],
  ['standard', '普通'],
  ['complex', '复杂'],
]
const MODE_OPTIONS = ['anchor', 'cheapest', 'strongest']
const MODE_LABELS: Record<string, string> = {
  anchor: '锚定父模型',
  cheapest: '最便宜',
  strongest: '最强',
}

/** Render one control for a field; edits flow to the parent via `onEdit`. */
function FieldControl(props: {
  field: Field
  value: Section
  disabled: boolean
  onEdit: (patch: Section) => void
}): React.ReactElement {
  const { field, value, disabled, onEdit } = props
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
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onEdit(field.set(value, e.target.value)),
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
              if (!Number.isNaN(n)) onEdit(field.set(value, n))
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
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onEdit(field.set(value, e.target.checked)),
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
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onEdit(field.set(value, e.target.value)),
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
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onEdit(
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
  const [draft, setDraft] = React.useState<Section | null>(null)
  React.useEffect(() => scope.subscribe(() => setSnapshot(scope.getSnapshot())), [scope])
  const committed = snapshot.value ?? ({} as Section)
  // Editing view = draft when present (unsaved edits), else the committed value.
  const value = draft ?? committed
  const dirty = draft !== null
  const disabled = !snapshot.writable || snapshot.status !== 'ready'
  if (snapshot.status === 'unavailable') {
    return React.createElement('div', { className: 'sr-card' },
      React.createElement('style', null, CSS),
      React.createElement('div', { className: 'sr-unavailable' },
        'subagent-router：此部署不可用该设置命名空间。'),
    )
  }
  const onEdit = (patch: Section): void => {
    setDraft(prev => ({ ...(prev ?? committed), ...patch }))
  }
  const onTierEdit = (tier: 'trivial' | 'standard' | 'complex', mode: string): void => {
    const base = draft ?? committed
    const next = { ...(base.autoTierPolicy ?? {}), [tier]: mode }
    setDraft({ ...base, autoTierPolicy: next })
  }
  const onSave = (): void => {
    if (draft === null) return
    for (const key of Object.keys(draft) as Array<keyof Section>) {
      const next = draft[key]
      if (next === undefined || next === '' || (Array.isArray(next) && next.length === 0)) {
        void scope.unset(key as string)
      } else {
        void scope.set(key as string, next as unknown)
      }
    }
    setDraft(null)
  }
  const onCancel = (): void => setDraft(null)
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
          '子任务模型路由：每次委派选择 provider / model（auto 策略，健康感知换路）。'),
      ),
      chevron,
    ),
    React.createElement('div', { className: 'sr-body' },
      React.createElement('div', { className: 'sr-note' },
        dirty ? '有未保存的修改。' : '修改保存后，下一次 subagent_model 调用即生效（无需重启）。'),
      ...FIELDS.map(field => React.createElement(FieldControl, {
        key: String(field.id),
        field,
        value,
        disabled,
        onEdit,
      })),
      ...TIER_LABELS.map(([tier, label]) => {
        const current = value.autoTierPolicy?.[tier] ?? ''
        return React.createElement('div', { className: 'sr-field', key: `tier-${tier}` },
          React.createElement('label', { className: 'sr-label', htmlFor: `sr-tier-${tier}` }, `${label}任务选型模式`),
          React.createElement('div', { className: 'sr-control' },
            React.createElement('select', {
              id: `sr-tier-${tier}`,
              className: 'sr-input',
              value: current,
              disabled,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onTierEdit(tier, e.target.value),
            }, MODE_OPTIONS.map(option =>
              React.createElement('option', { key: option, value: option }, MODE_LABELS[option] ?? option))),
          ),
          React.createElement('div', { className: 'sr-hint' },
            `${label}任务的选型模式（空 = 内置启发式）。`),
        )
      }),
      React.createElement('div', { className: 'sr-actions' },
        React.createElement('button', {
          className: 'sr-btn sr-btn-default',
          type: 'button',
          disabled: !dirty,
          onClick: onCancel,
        }, '放弃修改'),
        React.createElement('button', {
          className: 'sr-btn sr-btn-primary',
          type: 'button',
          disabled: !dirty || disabled,
          onClick: onSave,
        }, '保存'),
      ),
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
