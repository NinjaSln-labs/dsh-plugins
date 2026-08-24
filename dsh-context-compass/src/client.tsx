/**
 * dsh-context-compass — Client half.
 *
 * Renders a session-health badge in `conversation.session.header.utilities`
 * (right side of the session header, next to the Session log button), styled
 * with DSH theme tokens and sized identically to the adjacent button.
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
import * as React from 'react'
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
import type { SessionHealthProjection, HealthSeverity } from './types.ts'
import { cacheHitRateOf, type TokenUsageLike } from './usage.ts'
import { SNAPSHOT_SEPARATOR } from './knowledge.ts'
// 单点格式化：util.ts 是唯一算法位置（host 与 client 同源，防双源漂移）。
import { formatCompact, formatUsd, formatHitRate, formatCny } from './util.ts'

const CSS = `
.sh-wrap{position:relative;display:inline-flex}
.sh-badge{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:6px 12px;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-color:var(--sh-accent,var(--dsw-alias-border-l2));border-radius:18px;color:var(--dsw-alias-label-secondary);background:transparent;font-size:13px;font-weight:400;line-height:20px;box-sizing:border-box;cursor:pointer;user-select:none;white-space:nowrap}
.sh-badge:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-badge:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:2px}
.sh-badge .sh-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--sh-accent,var(--dsw-alias-label-secondary))}
/* Severity palette — three theme-adaptive roles per tier:
   --sh-accent (dot/border/bar), --sh-ink (severity text), --sh-tint (chip bg).
   Light themes deepen the hues for contrast on pale surfaces; dark themes
   lighten them for contrast on the dark overlay. All text ratios >= 3:1 in
   both themes (WCAG AA for graphical objects / emphasis); hue separation
   between the four tiers is kept wide in both themes. */
.sh-sev-green{--sh-accent:color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,black);--sh-ink:color-mix(in srgb,var(--dsw-alias-state-success-primary) 42%,black);--sh-tint:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent)}
.sh-sev-blue{--sh-accent:var(--dsw-static-blue-600);--sh-ink:var(--dsw-static-blue-600);--sh-tint:color-mix(in srgb,var(--dsw-static-blue-500) 13%,transparent)}
.sh-sev-yellow{--sh-accent:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 30%,black);--sh-ink:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 42%,black);--sh-tint:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 14%,transparent)}
.sh-sev-red{--sh-accent:var(--dsw-alias-state-error-primary);--sh-ink:var(--dsw-alias-state-error-primary);--sh-tint:color-mix(in srgb,var(--dsw-alias-state-error-primary) 13%,transparent)}
body[data-ds-dark-theme] .sh-sev-green{--sh-accent:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,white);--sh-ink:color-mix(in srgb,var(--dsw-alias-state-success-primary) 55%,white)}
body[data-ds-dark-theme] .sh-sev-blue{--sh-accent:color-mix(in srgb,var(--dsw-static-blue-500) 50%,white);--sh-ink:color-mix(in srgb,var(--dsw-static-blue-500) 55%,white)}
body[data-ds-dark-theme] .sh-sev-yellow{--sh-accent:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,white);--sh-ink:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,white)}
body[data-ds-dark-theme] .sh-sev-red{--sh-accent:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,white);--sh-ink:color-mix(in srgb,var(--dsw-alias-state-error-primary) 55%,white)}
.sh-tip{position:absolute;top:calc(100% + 8px);right:0;min-width:280px;max-width:min(420px,calc(100vw - 24px));background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.22);z-index:50;text-align:left}
.sh-tip-title{font-size:13px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.sh-tip-title .sh-sev-label{color:var(--sh-ink,var(--dsw-alias-label-secondary));font-weight:600}
.sh-tip-advice{font-size:13px;line-height:1.6;padding:8px 10px;border-radius:8px;font-weight:600;color:var(--sh-ink,var(--dsw-alias-label-primary));background:var(--sh-tint,transparent);margin-bottom:8px;overflow-wrap:anywhere}
.sh-tip-row{display:flex;align-items:center;gap:10px;line-height:2}
.sh-tip-row .sh-k{color:var(--dsw-alias-label-secondary);flex:none}
.sh-tip-row .sh-v{color:var(--dsw-alias-label-secondary);margin-left:auto;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;min-width:0}
.sh-cost-toggle{cursor:pointer;border-radius:4px}
.sh-cost-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-cost-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
.sh-bar{flex:1;height:6px;border-radius:3px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;max-width:110px}
.sh-bar-fill{height:100%;border-radius:3px;display:block;background:var(--sh-accent,var(--dsw-alias-label-secondary))}
.sh-tip-hint{margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px}
/* 复制交接摘要（B3）：浮层底部动作行。 */
.sh-tip-copy-row{margin-top:8px;display:flex}
.sh-tip-copy{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;padding:3px 10px;cursor:pointer;flex:none}
.sh-tip-copy:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-tip-copy:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
.sh-tip-copy-done{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
/* 浮层信息分层（B2）：「更多详情」折叠次要行。 */
.sh-tip-more{margin-top:6px;border:none;background:none;padding:0;color:var(--dsw-alias-label-tertiary);font-size:11px;cursor:pointer;text-align:left}
.sh-tip-more:hover{color:var(--dsw-alias-label-primary)}
.sh-tip-more:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px;border-radius:3px}
/* 压缩后判定滞后提示：severity 判定基于压缩前压力，占用条已按下次请求重估——
   差异超过阈值时标注「下次请求后更新」（theme-adaptive warn tint）。 */
.sh-tip-lag{margin-top:8px;padding:6px 10px;border-radius:8px;font-size:12px;line-height:1.5;color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,var(--dsw-alias-label-primary));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
/* Invisible bridge over the badge↔tooltip gap: the mouse path into the
   tooltip never leaves the wrapper, so the popover stays clickable. */
.sh-tip::before{content:'';position:absolute;top:-8px;left:0;right:0;height:8px}
.sh-tip{animation:sh-tip-in .15s ease-out}
@keyframes sh-tip-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.sh-tip{animation:none}}
@media (prefers-reduced-motion: reduce){.sh-rowtip{animation:none}}
/* Sidebar footer action (multi-session overview opener): styled and sized
   like the New Session button (38px, radius 12, elevated fill + border,
   full column width like the Settings row), entirely on theme tokens so it
   follows light/dark themes with the shell. Rail state mirrors the New
   Session rail icon (36px, borderless, hover tint). */
.sh-fa{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:8px 16px;margin:0 2px 8px;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px;flex:none;cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden}
.sh-fa:hover{background:var(--dsw-alias-button-floating-hover)}
.sh-fa:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:2px}
.sh-fa .sh-fa-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}
.sh-fa-rail{width:36px;height:36px;padding:0;margin:0 0 12px;align-self:flex-start;border-color:transparent;background:transparent}
.sh-fa-rail:hover{background:var(--dsw-alias-interactive-bg-hover)}
/* Overview panel: frame-wide scrim + centered card. The shell.overlay layer
   is click-through by default — the panel opts back into pointer events. */
.sh-scrim{position:fixed;inset:0;background:color-mix(in srgb,var(--dsw-alias-bg-base) 62%,transparent);display:flex;align-items:center;justify-content:center;padding:32px;pointer-events:auto;z-index:60;animation:sh-fade-in .15s ease-out}
@keyframes sh-fade-in{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion: reduce){.sh-scrim{animation:none}}
.sh-panel{width:min(620px,100%);max-height:min(76vh,720px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.3);overflow:hidden}
.sh-panel-head{display:flex;align-items:baseline;gap:10px;padding:14px 16px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.sh-panel-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.sh-panel-sub{font-size:12px;color:var(--dsw-alias-label-tertiary);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sh-panel-close{flex:none;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:16px;line-height:1;cursor:pointer}
.sh-panel-close:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-panel-close:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
/* The list keeps the height of exactly 5 rows whether or not there are 5 —
   the panel never resizes (no visual jump when sessions come and go). */
.sh-panel-list{overflow-y:auto;padding:8px 0;flex:none;overscroll-behavior:contain;height:calc(41px * 5 + 16px);box-sizing:border-box}
/* Table-like layout: one grid per header/row, identical columns — title,
   workspace and numbers never misalign. Columns: sev | session | ws | occ |
   round | scale | created. */
.sh-grid-cols{grid-template-columns:80px 46px 46px 50px 54px 76px 56px;justify-content:start}
.sh-panel-head-row{display:grid;gap:14px;align-items:center;box-sizing:border-box;width:100%;padding:9px 16px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary);letter-spacing:.03em;font-variant-numeric:tabular-nums}
.sh-col-head{border:none;background:transparent;color:inherit;font:inherit;padding:0;cursor:pointer;text-align:left;border-radius:4px;display:inline-flex;align-items:center;gap:3px}
.sh-panel-head-row .sh-row-num.sh-col-head{justify-content:flex-end;width:100%}
.sh-col-head:hover{color:var(--dsw-alias-label-primary)}
.sh-col-head:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
.sh-col-head.sh-sort-active{color:var(--dsw-alias-label-primary);font-weight:600}
.sh-panel-row{display:grid;gap:14px;align-items:center;width:100%;height:41px;padding:0 16px;border:none;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;box-sizing:border-box;font-size:12px;line-height:1.4}
.sh-panel-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-panel-row:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
/* Severity as a tinted chip (theme-adaptive tint/ink from the palette). */
.sh-sev-chip{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:999px;background:var(--sh-tint,transparent);color:var(--sh-ink,var(--dsw-alias-label-secondary));font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;width:fit-content}
.sh-row-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--sh-accent,var(--dsw-alias-label-tertiary))}
.sh-row-running{color:var(--dsw-alias-state-success-primary);font-weight:600}
.sh-row-loaded{color:var(--dsw-alias-label-secondary)}
.sh-row-cold{color:var(--dsw-alias-label-tertiary)}
.sh-row-cell{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.sh-row-num{text-align:right;font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.sh-dim{color:var(--dsw-alias-label-tertiary)}
.sh-rowtip{position:fixed;transform:translate(-50%,-100%);z-index:80;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 6px 18px rgba(0,0,0,.22);pointer-events:none;white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis;animation:sh-tip-in .12s ease-out}
.sh-rowtip-below{transform:translate(-50%,0)}
/* /compass rich card in the chat flow (commandview seat). */
.sh-ccard{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:6px}
.sh-ccard[data-error="true"]{border-color:var(--dsw-alias-state-error-primary)}
.sh-ccard-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sh-ccard-title{font-size:12px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
/* 触发时间标签：连续多张 /compass 卡时能看出是不同时刻的独立动作。 */
.sh-ccard-time{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-left:auto;flex:none}
.sh-ccard-summary{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.sh-ccard-state{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.sh-ccard-toggle{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;padding:2px 8px;cursor:pointer;flex:none}
.sh-ccard-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.sh-ccard-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
.sh-ccard-reason{font-size:12px;line-height:1.6}
.sh-ccard-metrics{display:flex;flex-wrap:wrap;gap:4px 14px}
/* 短 metric 单行、长 metric（如跨会话回顾快照）可折行——绝不撑破卡片。 */
.sh-ccard-metric{display:inline-flex;align-items:baseline;gap:4px;white-space:normal;min-width:0}
.sh-ccard-mkey{color:var(--dsw-alias-label-tertiary);flex:none}
.sh-ccard-mval{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;min-width:0}
.sh-ccard-mfull{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;min-width:0}
.sh-ccard-checklist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.sh-ccard-cdone{color:var(--dsw-alias-state-success-primary)}
.sh-ccard-copen{color:var(--dsw-alias-label-secondary)}
.sh-ccard-body{margin:0;padding:8px 10px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary);max-height:40vh;overflow-y:auto}

.sh-panel-empty{display:flex;align-items:center;justify-content:center;height:100%;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary)}
.sh-panel-foot{padding:8px 16px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:10px;min-height:34px}
.sh-pager{display:inline-flex;align-items:center;gap:6px;flex:none}
.sh-pager-btn{width:22px;height:22px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;cursor:pointer;padding:0}
.sh-pager-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.sh-pager-btn:disabled{opacity:.4;cursor:default}
.sh-pager-btn:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
.sh-pager-info{font-variant-numeric:tabular-nums;min-width:34px;text-align:center}
.sh-foot-hint{margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`

/** Null-safe compact token display — util.ts formatCompact with the unknown fallback. */
function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '未知'
  return formatCompact(n)
}

/**
 * Visible severity label — uniformly 4 characters per column head / row
 * cell, and the wording must stay MONOTONIC (no tier may read lighter than
 * the one below it): 放心继续 → 继续留意 → 建议收尾 → 尽快收尾. The full
 * advice text (hover / /compass) carries the nuance; this is the速记.
 */
const SEVERITY_LABEL: Record<HealthSeverity, string> = {
  green: '放心继续',
  blue: '继续留意',
  yellow: '建议收尾',
  red: '尽快收尾',
}

/** aria-label variant keeps the color word: screen readers cannot see the chip color. */
const SEVERITY_ARIA: Record<HealthSeverity, string> = {
  green: '绿：放心继续',
  blue: '蓝：继续留意',
  yellow: '黄：建议收尾',
  red: '红：尽快收尾',
}

/** Projection face shape from the runtime client. */
interface ProjectionFace {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

/**
 * token-meter's contextPressure projection value (the harness core publishes
 * it alongside sessionHealth; compaction-aware).
 */
export interface ContextPressureLike {
  /** Provider-reported prompt size of the most recent request. */
  pressureTokens?: number
  /** What the NEXT request's prompt would cost (reacts to compaction). */
  projectedTokens?: number
  /** Newest known route capacity. */
  contextWindow?: number
}

/**
 * Merge the sessionHealth verdict with token-meter's compaction-aware
 * contextPressure numbers: the occupancy figure the badge displays should be
 * "what the next request costs", not a stale pre-compaction sample. Pure.
 */
export function mergePressure(
  proj: SessionHealthProjection | undefined,
  pressure: ContextPressureLike | undefined,
): { total: number | null; window: number | null; ratio: number | null; projected: number | null } {
  const total = proj?.total ?? pressure?.pressureTokens ?? pressure?.projectedTokens ?? null
  const window = proj?.window ?? pressure?.contextWindow ?? null
  const ratio = total !== null && window !== null && window > 0 ? total / window : null
  const projected = pressure?.projectedTokens ?? null
  return { total, window, ratio, projected }
}

/**
 * 压缩后判定滞后检测（pure）：severity 判定走 last-wins 压力（压缩前快照），
 * 占用条走 compaction-aware projectedTokens（下次请求成本）——两者分叉说明
 * 判定尚未被下一次请求刷新。差异 ≥5 个百分点且确实发生过压缩才标注
 * （roadmap「压缩后判定滞后标注」）。
 */
export function lagOf(
  proj: SessionHealthProjection | undefined,
  pressure: ContextPressureLike | undefined,
): { lag: boolean; oldPct: number | null; newPct: number | null } {
  const merged = mergePressure(proj, pressure)
  const pctOf = (t: number | null): number | null =>
    t !== null && merged.window !== null && merged.window > 0
      ? Math.min(Math.round((t / merged.window) * 100), 100)
      : null
  const oldPct = pctOf(merged.total)
  const newPct = pctOf(merged.projected)
  const lag = (proj?.compactions ?? 0) > 0
    && merged.projected !== null
    && merged.total !== null
    && merged.total > 0
    && merged.projected < merged.total
    && oldPct !== null && newPct !== null
    && oldPct - newPct >= 5
  return { lag, oldPct, newPct }
}

/** Commands Remote face (core, always mounted). */
interface CommandsRemote {
  execute(sessionId: string, line: string): Promise<unknown>
}

function HealthBadge(props: {
  sessionId: string
  commands: CommandsRemote
  sessions: {
    binding(sessionId: string): { session: { projections: { faceOf(key: string): ProjectionFace | undefined } } } | undefined
  }
  locale: { snapshot: { active: string } }
}): JSX.Element {
  const [proj, setProj] = React.useState<SessionHealthProjection | undefined>(undefined)
  const [pressure, setPressure] = React.useState<ContextPressureLike | undefined>(undefined)
  // Core tokenUsage projection value — same source as the input-bar stats line.
  const [usage, setUsage] = React.useState<TokenUsageLike | undefined>(undefined)
  const [hover, setHover] = React.useState(false)
  // 计费预期行的显示口径：金额（默认）↔ 计费当量 token 数。点击行切换，localStorage 记住。
  const [costAsTokens, setCostAsTokens] = React.useState<boolean>(() => {
    try { return window.localStorage.getItem('dsh-context-compass/costDisplay') === 'tokens' } catch { return false }
  })
  // 交接摘要复制反馈（B3）：点击 → RPC 取真实摘要 → 剪贴板 → 短暂显示「已复制」。
  const [copied, setCopied] = React.useState(false)
  // 浮层信息分层（B2）：核心行（占用/每轮/预计下次/计费）默认，次要行
  // （窗口/规模/压缩）折叠在「更多详情」。
  const [showMore, setShowMore] = React.useState(false)
  const copiedTimer = React.useRef<number | null>(null)
  const mountedRef = React.useRef(true)
  const copySummary = () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
    const finish = (ok: boolean) => {
      if (!mountedRef.current) return // 浮层关闭/组件卸载后不再 setState
      setCopied(ok)
      copiedTimer.current = window.setTimeout(() => {
        if (mountedRef.current) setCopied(false)
      }, 2000)
    }
    try {
      void fetch('/context-compass-rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'summary', sessionId: props.sessionId }),
      }).then(res => res.json()).then(async (json: { ok?: boolean; result?: { text?: string } }) => {
        const text = json.ok === true ? json.result?.text : undefined
        if (typeof text !== 'string' || text === '') { finish(false); return }
        try {
          await navigator.clipboard.writeText(text)
          finish(true)
        } catch { finish(false) }
      }).catch(() => finish(false))
    } catch { finish(false) }
  }
  React.useEffect(() => () => {
    mountedRef.current = false
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
  }, [])
  // 浮层消失延迟：徽章↔浮层的空隙由 .sh-tip::before 桥接，延迟兜底快速抖动；
  // 键盘聚焦（Tab 进徽章）也打开浮层，blur 移出子树才关闭。
  const hoverTimer = React.useRef<number | null>(null)
  const showTip = () => {
    if (hoverTimer.current !== null) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null }
    setHover(true)
  }
  const hideTip = () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(() => setHover(false), 250)
  }
  React.useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
  }, [])

  React.useEffect(() => {
    let alive = true
    // Projection push path — frames update the badge the moment the host fold
    // changes. Absence of a value means "no frame yet" (gray state), never a
    // reason to poll: the projection seam is the only client data path.
    const binding = props.sessions.binding?.(props.sessionId)?.session?.projections
    const face = binding?.faceOf?.('sessionHealth')
    const pressureFace = binding?.faceOf?.('contextPressure')
    // Cache-hit rate rides the CORE tokenUsage projection — the exact value
    // the input-bar stats line shows (src/usage.ts has the single formula).
    const usageFace = binding?.faceOf?.('tokenUsage')
    if (face === undefined && pressureFace === undefined && usageFace === undefined) return () => { alive = false }
    const readHealth = () => {
      if (!alive) return
      const v = face?.getSnapshot()
      if (v !== undefined && v !== null) setProj(v as SessionHealthProjection)
    }
    const readPressure = () => {
      if (!alive) return
      const v = pressureFace?.getSnapshot()
      if (v !== undefined && v !== null) setPressure(v as ContextPressureLike)
    }
    const readUsage = () => {
      if (!alive) return
      const v = usageFace?.getSnapshot()
      if (v !== undefined && v !== null) setUsage(v as TokenUsageLike)
    }
    readHealth()
    readPressure()
    readUsage()
    const offs = [
      face !== undefined ? face.subscribe(readHealth) : () => {},
      pressureFace !== undefined ? pressureFace.subscribe(readPressure) : () => {},
      usageFace !== undefined ? usageFace.subscribe(readUsage) : () => {},
    ]
    return () => {
      alive = false
      for (const off of offs) off()
    }
  }, [props.sessionId])

  // The verdict (color/advice) is host-computed and authoritative; the
  // displayed occupancy merges in token-meter's compaction-aware numbers —
  // the occupancy figure is "what the next request costs", not a stale
  // pre-compaction sample. After a compaction the projected next-request
  // cost drives the bar/% while the verdict still rides last-wins pressure;
  // lagOf() annotates that divergence (roadmap: 压缩后判定滞后标注).
  const merged = mergePressure(proj, pressure)
  const severity: HealthSeverity | 'unknown' = proj?.severity ?? 'unknown'
  const displayRatio = merged.projected !== null && merged.window !== null && merged.window > 0
    ? merged.projected / merged.window
    : merged.ratio
  const pct = displayRatio !== null ? Math.min(Math.round(displayRatio * 100), 100) : null
  const lag = lagOf(proj, pressure)

  const runHealth = () => {
    try { void props.commands.execute(props.sessionId, '/compass') } catch { /* 静默 */ }
  }
  const toggleCost = () => {
    setCostAsTokens(v => {
      const next = !v
      try { window.localStorage.setItem('dsh-context-compass/costDisplay', next ? 'tokens' : 'money') } catch { /* 静默 */ }
      return next
    })
  }
  const onCostKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleCost()
    }
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      runHealth()
    }
  }

  const state = severity === 'unknown' ? 'unknown' : severity
  const text = '上下文' + (pct !== null ? ` ${pct}%` : '')

  let tip: JSX.Element | null = null
  if (hover) {
    const color = severity === 'unknown' ? null : severity
    const label = severity === 'unknown' ? '未知（等待数据）' : SEVERITY_LABEL[severity]
    const advice = proj?.advice ?? '正在获取上下文罗盘数据…'
    const bar = (
      <span className="sh-bar">
        <span className="sh-bar-fill" style={{ width: `${pct !== null ? Math.min(pct, 100) : 0}%` }} />
      </span>
    )
    tip = (
      <div className={`sh-tip${color !== null ? ` sh-sev-${color}` : ''}`}>
        <div className="sh-tip-title">
          上下文罗盘：
          <span className="sh-sev-label">{label}</span>
        </div>
        <div className="sh-tip-advice">{advice}</div>
        <div className="sh-tip-row">
          <span className="sh-k">上下文占用</span>
          {bar}
          <span className="sh-v">{pct !== null ? `${pct}%` : '未知'}</span>
        </div>
        <div className="sh-tip-row">
          <span className="sh-k">每轮输入</span>
          <span className="sh-v">约 {compact(merged.total)} token{(() => { const rate = cacheHitRateOf(usage); return rate !== null ? `（缓存命中 ${formatHitRate(rate)}）` : '' })()}</span>
        </div>
        {merged.projected !== null ? (
          <div className="sh-tip-row">
            <span className="sh-k">预计下次输入</span>
            <span className="sh-v">
              {proj?.cacheReadTokens !== null && proj?.cacheReadTokens !== undefined
                ? `约 ${compact(Math.max(0, merged.projected - proj.cacheReadTokens))} token 未命中 / 总量 ${compact(merged.projected)}`
                : `约 ${compact(merged.projected)} token`}
            </span>
          </div>
        ) : null}
        {(() => {
          const isZh = (props.locale?.snapshot?.active ?? 'zh') === 'zh'
          const cny = proj?.effectivePerRoundCny
          const usd = proj?.effectivePerRoundUsd
          const money = isZh && cny !== null && cny !== undefined
            ? formatCny(cny)
            : usd !== null && usd !== undefined ? formatUsd(usd) : null
          const effective = proj?.effectivePerRound
          if (money === null && effective === null) return null
          const period = proj?.pricePeriod === 'peak' ? '（忙时价）' : proj?.pricePeriod === 'offpeak' ? '（闲时价）' : ''
          return (
            <div
              className="sh-tip-row sh-cost-toggle"
              role="button"
              tabIndex={0}
              title={costAsTokens ? '点击切换为金额显示' : '点击切换为 token 数量显示'}
              aria-label={costAsTokens ? '计费预期，以 token 数量显示，点击切换为金额' : '计费预期，以金额显示，点击切换为 token 数量'}
              onClick={toggleCost}
              onKeyDown={onCostKeyDown}
            >
              <span className="sh-k">计费预期{costAsTokens ? '（token）' : ''}</span>
              <span className="sh-v">
                {costAsTokens
                  ? effective !== null
                    ? `约 ${compact(effective)} token/轮（计费当量）`
                    : `约 ${money ?? '未知'}/轮（含缓存折扣）${period}`
                  : money !== null
                    ? `约 ${money}/轮（含缓存折扣）${period}`
                    : `约 ${compact(effective ?? 0)} token/轮（计费当量）`}
              </span>
            </div>
          )
        })()}
        {/* 已压缩是核心信号（A1 压缩比例 + 滞后提示的前提），留在默认视图，
            不进「更多详情」折叠——只折叠纯信息行（窗口/规模）。 */}
        {proj !== undefined && proj.compactions > 0 ? (
          <div className="sh-tip-row">
            <span className="sh-k">已压缩</span>
            <span className="sh-v">
              {proj.compactions} 次
              {proj.compressionRatio !== null && proj.compressionRatio !== undefined
                ? `（上次压缩比例 ≈ ${Math.round(proj.compressionRatio * 100)}%，快照口径）`
                : ''}
            </span>
          </div>
        ) : null}
        {showMore ? (
          <>
            <div className="sh-tip-row">
              <span className="sh-k">模型窗口</span>
              <span className="sh-v">{compact(merged.window)}</span>
            </div>
            {proj !== undefined ? (
              <div className="sh-tip-row">
                <span className="sh-k">会话规模</span>
                <span className="sh-v">{proj.turns} 轮 / {proj.userMessages + proj.assistantMessages} 条消息</span>
              </div>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          className="sh-tip-more"
          onClick={() => setShowMore(v => !v)}
          aria-expanded={showMore}
        >
          {showMore ? '收起详情' : '更多详情'}
        </button>
        {lag.lag ? (
          <div className="sh-tip-lag" role="note">
            压缩后判定滞后：判定基于压缩前压力（{lag.oldPct}%），预计下次请求后更新（≈ {lag.newPct}%）
          </div>
        ) : null}
        <div className="sh-tip-copy-row">
          <button
            type="button"
            className={`sh-tip-copy${copied ? ' sh-tip-copy-done' : ''}`}
            onClick={copySummary}
            aria-label={copied ? '交接摘要已复制' : '复制交接摘要'}
            title="复制含真实交接状态的摘要文本"
          >
            {copied ? '✓ 已复制交接摘要' : '复制交接摘要'}
          </button>
        </div>
        <div className="sh-tip-hint">点击运行 /compass 查看完整报告；点击计费预期切换金额 / token 显示</div>
      </div>
    )
  }

  return (
    <span
      className="sh-wrap"
      onMouseEnter={showTip}
      onMouseLeave={hideTip}
      onFocus={showTip}
      onBlur={(e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hideTip()
      }}
    >
      <span
        className={`sh-badge${state !== 'unknown' ? ` sh-sev-${state}` : ''}`}
        role="button"
        tabIndex={0}
        aria-label={`上下文罗盘：${severity === 'unknown' ? '未知' : SEVERITY_ARIA[severity]}`}
        onClick={runHealth}
        onKeyDown={onKeyDown}
      >
        <span className="sh-dot" />
        <span>{text}</span>
      </span>
      {tip}
    </span>
  )
}

/**
 * /compass 富卡片 —— the `conversation.chat.commandview` seat (keyed by
 * command name, currently unoccupied) renders a structured card from the
 * command's markdown report instead of the generic text row.
 *
 * The report text format is owned by buildCommandText (src/command.ts):
 *   **放心继续**（健康度：**绿**）
 *   <reason>
 *   详情：
 *   - 会话规模：…
 *   - 每轮输入约 …（窗口 …%）
 *   - 缓存命中率 …
 *   - 计费预期：…
 *   [切换前检查：]
 *   - [x] 未提交变更：…
 * Parsing is best-effort: unknown shapes fall back to the raw text row.
 */

/** Parsed structure of one /compass report. */
export interface CompassReport {
  /** 绿/蓝/黄/红; null when the text does not carry the mark. */
  severity: 'green' | 'blue' | 'yellow' | 'red' | null
  /** First-line conclusion without markdown bold markers. */
  summary: string
  /** Reason line(s) right below the conclusion. */
  reason: string
  /** Detail rows (会话规模 / 每轮 / 缓存命中 / 计费…). */
  metrics: string[]
  /** Handoff checklist rows verbatim ([x]/[ ]). */
  checklist: string[]
}

const SEV_MAP: Record<string, 'green' | 'blue' | 'yellow' | 'red'> = {
  绿: 'green',
  蓝: 'blue',
  黄: 'yellow',
  红: 'red',
}

/** Best-effort parser for the report text produced by buildCommandText. */
export function parseCompassReport(text: string): CompassReport {
  const lines = text.split(/\r?\n/)
  const sev = text.match(/健康度：\*\*(绿|蓝|黄|红)\*\*/)
  const summary = (lines[0] ?? '').replace(/\*\*/g, '').trim()
  const rest = lines.slice(1)
  const reason: string[] = []
  const metrics: string[] = []
  const checklist: string[] = []
  let inChecklist = false
  for (const raw of rest) {
    const line = raw.trim()
    if (line === '') continue
    // 尾部结构化交接快照段（buildCommandText 始终追加）：`---` 起头，
    // 机器摄取区，不属于人读卡片——遇到即停止解析（快照段之后无用户内容）。
    // 分隔行与 knowledge.ts 共享 SNAPSHOT_SEPARATOR（防两处漂移）。
    if (line === SNAPSHOT_SEPARATOR) break
    if (line.startsWith('- [x]') || line.startsWith('- [ ]')) {
      inChecklist = true
      checklist.push(line)
      continue
    }
    if (inChecklist) continue
    if (line.startsWith('- ')) { metrics.push(line.slice(2).trim()); continue }
    if (line === '详情：' || line === '切换前检查：') continue
    reason.push(line)
  }
  return {
    severity: sev !== null ? SEV_MAP[sev[1]] ?? null : null,
    summary: summary !== '' ? summary : '（无结论）',
    reason: reason.join(' '),
    metrics,
    checklist,
  }
}

/**
 * The /compass rich card: severity chip + conclusion + reason, key metric
 * rows, the real handoff checklist, and the full report in a <pre> body
 * (the default card's own body is a <pre> too — no markdown renderer
 * involved). Running/error states degrade to the generic text row.
 */
/** 命令触发时间 → HH:MM:SS（跨天则 MM-DD HH:MM），连续卡片的分隔标识。 */
function commandTimeLabel(time: number | undefined): string | null {
  if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return null
  const d = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? hhmm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}`
}

/**
 * The /compass rich card: severity chip + conclusion + reason, key metric
 * rows, the real handoff checklist, and the full report in a <pre> body
 * (the default card's own body is a <pre> too — no markdown renderer
 * involved). Running/error states degrade to the generic text row. The head
 * carries the trigger time so consecutive cards read as separate actions.
 */
function CompassCommandCard(props: {
  node: {
    name?: string | null
    time?: number
    outcome?: { kind?: string; text?: string } | null
  }
}): JSX.Element {
  // 默认收起：完整报告（<pre> 正文）默认折叠，头部结论/指标一眼可见，
  // 需要细节再展开——多张卡并排时不再整页高度堆叠。
  const [expanded, setExpanded] = React.useState(false)
  const outcome = props.node.outcome
  const text = outcome?.text
  const timeLabel = commandTimeLabel(props.node.time)
  const timeTag = timeLabel !== null ? <span className="sh-ccard-time">{timeLabel}</span> : null
  if (outcome === null || outcome === undefined) {
    return (
      <div className="sh-ccard">
        <div className="sh-ccard-head"><span className="sh-ccard-title">/compass</span><span className="sh-ccard-state">运行中…</span>{timeTag}</div>
      </div>
    )
  }
  if (outcome.kind !== 'success' || text === undefined || text === '') {
    return (
      <div className="sh-ccard" data-error="true">
        <div className="sh-ccard-head">
          <span className="sh-ccard-title">/compass</span>
          <span className="sh-ccard-state">执行失败</span>
          {timeTag}
          {text !== undefined ? (
            <button
              type="button"
              className="sh-ccard-toggle"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              aria-label={expanded ? '收起失败详情' : '展开失败详情'}
            >
              {expanded ? '收起' : '展开'}
            </button>
          ) : null}
        </div>
        {expanded && text !== undefined ? <pre className="sh-ccard-body">{text}</pre> : null}
      </div>
    )
  }
  const report = parseCompassReport(text)
  const sev = report.severity
  return (
    <div className={`sh-ccard${sev !== null ? ` sh-sev-${sev}` : ''}`}>
      <div className="sh-ccard-head">
        <span className="sh-ccard-title">/compass</span>
        {sev !== null ? <span className="sh-sev-chip"><span className="sh-row-dot" />{SEVERITY_LABEL[sev]}</span> : null}
        <span className="sh-ccard-summary">{report.summary}</span>
        {timeTag}
        <button
          type="button"
          className="sh-ccard-toggle"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? '收起完整报告' : '展开完整报告'}
        >
          {expanded ? '收起' : '展开'}
        </button>
      </div>
      {report.reason !== '' ? <div className="sh-ccard-reason">{report.reason}</div> : null}
      {report.metrics.length > 0 ? (
        <div className="sh-ccard-metrics">
          {report.metrics.map((m, i) => {
            const colon = m.indexOf('：')
            const key = colon > 0 ? m.slice(0, colon) : null
            const value = colon > 0 ? m.slice(colon + 1) : m
            return key !== null
              ? (
                <span key={i} className="sh-ccard-metric">
                  <span className="sh-ccard-mkey">{key}</span>
                  <span className="sh-ccard-mval">{value}</span>
                </span>
              )
              : <span key={i} className="sh-ccard-metric sh-ccard-mfull">{m}</span>
          })}
        </div>
      ) : null}
      {report.checklist.length > 0 ? (
        <ul className="sh-ccard-checklist">
          {report.checklist.map((c, i) => (
            <li key={i} className={c.startsWith('- [x]') ? 'sh-ccard-cdone' : 'sh-ccard-copen'}>{c.slice(5)}</li>
          ))}
        </ul>
      ) : null}
      {expanded ? <pre className="sh-ccard-body">{text}</pre> : null}
    </div>
  )
}

/**
 * Multi-session overview panel — the 上下文罗盘一览 roadmap item.
 *
 * Two seats share one tiny open-state store (created per apply, disposed with
 * the fiber): `sidebar.footer.action` opens the panel, `shell.overlay`
 * renders it while open and null otherwise (the overlay pattern: "each reads
 * its own store and renders null while closed"). Data rides the same-origin
 * host RPC route `/context-compass-rpc` (bundle clients cannot mount a plugin
 * Remote — the imgdraw seam), fetched on open and refreshed while open.
 * Rows are host-sorted red → yellow → blue → green → unknown; clicking a row
 * opens that session and runs /compass for it.
 */

/** Refresh cadence of the open panel (ms). */
const PANEL_REFRESH_MS = 5000

/** Minimal row shape from the host overview RPC. */
interface OverviewRowLike {
  id: string
  title: string | null
  /** 真实活动三态：运行中（智能体回回合）/ 已加载（内存驻留待命）/ 冷却（仅持久化）。 */
  status: 'running' | 'loaded' | 'cold'
  createdAt: number
  health: SessionHealthProjection | null
  workspace: { id: string; title: string } | null
}

/** External open-state store shared by the footer action and the overlay. */
class OverviewStore {
  private open = false
  private readonly listeners = new Set<() => void>()
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  getOpen = (): boolean => this.open
  setOpen(open: boolean): void {
    if (this.open === open) return
    this.open = open
    for (const listener of [...this.listeners]) listener()
  }
}

const SEVERITY_RANK: Record<HealthSeverity, number> = { red: 0, yellow: 1, blue: 2, green: 3 }

/** Relative creation time — repeated titles stay distinguishable in the list. */
function ageOf(ts: number): string {
  if (ts <= 0) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
}


/**
 * 相对时间（上次使用）：与侧边栏行尾同风格的紧凑桶（刚刚 / N分前 / N时前 /
 * N天前 / N月前）。`now` 由调用方传入，便于轮询帧统一刷新。
 */
function agoShort(updatedAt: number | undefined, now: number): string {
  if (updatedAt === undefined || !(updatedAt > 0)) return '—'
  const s = Math.max(0, Math.floor((now - updatedAt) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}分前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}月前`
  return `${Math.floor(mo / 12)}年前`
}

/** Full date for hover titles: YYYY-MM-DD. */
function dateFull(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Sort modes: 'severity' = 方案 A (tier → activity → newest), 'time' = newest first. */
type SortMode = 'severity' | 'time'

/** Activity sort rank: running first, then loaded, then cold. */
function activityRankOf(status: OverviewRowLike['status'] | undefined): number {
  return status === 'running' ? 0 : status === 'loaded' ? 1 : 2
}

/** 状态列的三态文案/样式/说明（运行中=智能体回合中；已加载=待命；冷却=仅持久化）。 */
const ACTIVITY_LABEL: Record<OverviewRowLike['status'], { label: string; cls: string; tip: string; meta: string }> = {
  running: { label: '运行中', cls: 'sh-row-running', tip: '智能体正在处理回回合（进行中）', meta: '运行中（智能体在工作）' },
  loaded: { label: '已加载', cls: 'sh-row-loaded', tip: '内存驻留待命（空闲）', meta: '已加载（内存驻留·空闲）' },
  cold: { label: '冷却', cls: 'sh-row-cold', tip: '仅持久化（未加载）', meta: '冷会话（仅持久化）' },
}

/** 每轮金额（含缓存折扣），zh 显示 CNY 否则 USD；null 表示暂无计费数据。 */
function moneyOf(proj: SessionHealthProjection | null, isZh: boolean): string | null {
  if (proj === null) return null
  const cny = proj.effectivePerRoundCny
  const usd = proj.effectivePerRoundUsd
  if (isZh && cny !== null && cny !== undefined) return formatCny(cny)
  if (usd !== null && usd !== undefined) return formatUsd(usd)
  return null
}

/** Rows arrive host-sorted (severity mode); the client re-sorts locally for
    the selected mode and refreshes. */
function sortRows(
  rows: OverviewRowLike[],
  mode: SortMode,
  updatedById: Record<string, { updatedAt?: number }> = {},
): OverviewRowLike[] {
  const updated = (r: OverviewRowLike): number => updatedById[r.id]?.updatedAt ?? r.createdAt ?? 0
  return [...rows].sort((a, b) => {
    if (mode === 'time') return updated(b) - updated(a)
    // 运行中永远置顶（跨 severity tier，与 host sortOverviewRows 同规则）：
    // 正在烧 token 的会话是用户正盯着的；其余行保持 红→黄→蓝→绿→未知。
    const ra = a.status === 'running' ? -1 : a.health === null ? 4 : SEVERITY_RANK[a.health.severity] ?? 4
    const rb = b.status === 'running' ? -1 : b.health === null ? 4 : SEVERITY_RANK[b.health.severity] ?? 4
    if (ra !== rb) return ra - rb
    const aa = activityRankOf(a.status)
    const ab = activityRankOf(b.status)
    if (aa !== ab) return aa - ab
    return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })
}

/** Panel page size (agreed: 5 rows per page — the usual live-session count). */
const PAGE_SIZE = 5

/** Sidebar-foot action: opens the overview panel (wide row vs 56px rail). */
function OverviewAction(props: {
  wide: boolean
  store: OverviewStore
}): JSX.Element {
  return (
    <button
      type="button"
      className={`sh-fa${props.wide ? '' : ' sh-fa-rail'}`}
      onClick={() => props.store.setOpen(true)}
      aria-label="上下文罗盘一览（打开所有会话的上下文面板）"
      title="上下文罗盘一览"
    >
      <span className="sh-fa-dot" />
      {props.wide ? <span>罗盘一览</span> : null}
    </button>
  )
}

/** Full-screen overview panel; renders null while closed. */
function OverviewPanel(props: {
  store: OverviewStore
  sessions: { open(id: string): void; list: { getSnapshot(): { byId: Record<string, { updatedAt?: number }> } } }
  commands: CommandsRemote
  locale: { snapshot: { active: string } }
}): JSX.Element | null {
  const open = React.useSyncExternalStore(props.store.subscribe, props.store.getOpen)
  if (!open) return null
  return <OverviewBody {...props} />
}

function OverviewBody(props: {
  store: OverviewStore
  sessions: { open(id: string): void; list: { getSnapshot(): { byId: Record<string, { updatedAt?: number }> } } }
  commands: CommandsRemote
  locale: { snapshot: { active: string } }
}): JSX.Element {
  const [rows, setRows] = React.useState<OverviewRowLike[] | null>(null)
  const [sortMode, setSortMode] = React.useState<SortMode>(() => {
    try { return window.localStorage.getItem('dsh-context-compass/overviewSort') === 'time' ? 'time' : 'severity' } catch { return 'severity' }
  })
  const [page, setPage] = React.useState(0)
  // Hover tooltip: VIEWPORT coords (fixed positioning — the tooltip never
  // participates in the list's scroll geometry, so no clipping and no
  // scrollbar flash) + the owning row id (every row used to render its own).
  const [tip, setTip] = React.useState<{ rowId: string; cx: number; cy: number } | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const closeRef = React.useRef<HTMLButtonElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)
  // The refresh interval's load() closure must see the current sort mode.
  const sortModeRef = React.useRef<SortMode>(sortMode)
  sortModeRef.current = sortMode
  // 上次使用时间（sessions store 的 byId）：同步读 + ref，供 load()/changeSort
  // 闭包与渲染共同使用；store 未就绪时为空表（全部显示 —）。
  const updatedByIdRef = React.useRef<Record<string, { updatedAt?: number }>>({})
  try { updatedByIdRef.current = props.sessions.list.getSnapshot().byId ?? {} } catch { /* store 未就绪 */ }

  // Fetch on mount + refresh while open; component unmounts when closed, so
  // the effect cleans up with it (no leak across panel sessions). The current
  // session id (fed by the badge) anchors the workspace scope host-side.
  React.useEffect(() => {
    let alive = true
    let timer: number | null = null
    const load = async () => {
      try {
        const res = await fetch('/context-compass-rpc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ method: 'overview' }),
        })
        const json = (await res.json()) as { ok?: boolean; error?: string; result?: { sessions?: OverviewRowLike[] } }
        if (!alive) return
        if (json.ok === true && Array.isArray(json.result?.sessions)) {
          const next = sortRows(json.result.sessions, sortModeRef.current, updatedByIdRef.current)
          // Refresh keeps the current page (a 5s poll must not kick the user
          // back to page one); clamp when sessions shrank below the page.
          const pages = Math.max(1, Math.ceil(next.length / PAGE_SIZE))
          setPage(p => Math.min(p, pages - 1))
          setRows(next)
          setLoadError(null)
        } else {
          setLoadError(json.error ?? '未知错误')
        }
      } catch {
        if (alive) setLoadError('无法连接 /context-compass-rpc')
      }
    }
    void load()
    timer = window.setInterval(() => { void load() }, PANEL_REFRESH_MS)
    return () => {
      alive = false
      if (timer !== null) window.clearInterval(timer)
    }
  }, [props.store])

  // Esc closes; focus moves into the panel on open. The page behind the
  // overlay must not scroll (wheel passes through the scrim otherwise).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.store.setOpen(false)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [props.store])

  const close = () => props.store.setOpen(false)
  const isZh = (props.locale?.snapshot?.active ?? 'zh') === 'zh'
  const openSession = (id: string) => {
    try { props.sessions.open(id) } catch { /* 静默 */ }
    // 冷会话：sessions.open 是异步加载（agent 初始化），立即 execute 会在
    // UI request 的 signal 被 abort（面板 close/组件卸载）时让 assess 中途
    // 挂掉 → 「执行失败 This operation was aborted」。给加载一点时间再发。
    window.setTimeout(() => {
      try { void props.commands.execute(id, '/compass') } catch { /* 静默 */ }
    }, 600)
    close()
  }
  const redCount = rows === null ? 0 : rows.filter(r => r.health?.severity === 'red').length
  const yellowCount = rows === null ? 0 : rows.filter(r => r.health?.severity === 'yellow').length
  const pageCount = rows === null ? 0 : Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pageRows = rows === null ? null : rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const changeSort = (mode: SortMode) => {
    setSortMode(mode)
    try { window.localStorage.setItem('dsh-context-compass/overviewSort', mode) } catch { /* 静默 */ }
    if (rows !== null) setRows(sortRows(rows, mode, updatedByIdRef.current))
    setPage(0)
    listRef.current?.scrollTo({ top: 0 })
  }
  const gotoPage = (next: number) => {
    setPage(next)
    listRef.current?.scrollTo({ top: 0 })
  }
  const sub = rows === null
    ? '加载中…'
    : `${rows.length} 个会话${redCount > 0 ? ` · 红 ${redCount}` : ''}${yellowCount > 0 ? ` · 黄 ${yellowCount}` : ''}`
  // 上次使用时间：sessions store 的 byId 行（与侧边栏同源），每次渲染同步读——
  // 5s 轮询帧自然刷新相对时间。store 缺行（冷会话未入列表）时显示 —。
  const nowMs = Date.now()
  const updatedById = updatedByIdRef.current

  return (
    <div className="sh-scrim" onClick={close}>
      <div
        className="sh-panel"
        role="dialog"
        aria-modal="true"
        aria-label="上下文罗盘一览"
        onClick={e => e.stopPropagation()}
      >
        <div className="sh-panel-head">
          <span className="sh-panel-title">上下文罗盘一览</span>
          <span className="sh-panel-sub">{sub}</span>
          <button
            type="button"
            ref={closeRef}
            className="sh-panel-close"
            aria-label="关闭上下文罗盘一览"
            onClick={close}
          >
            ×
          </button>
        </div>
        <div className="sh-panel-head-row sh-grid-cols" role="row">
          <button type="button" className={`sh-col-head${sortMode === 'severity' ? ' sh-sort-active' : ''}`} onClick={() => changeSort('severity')} aria-label="按健康状态排序">健康{sortMode === 'severity' ? '↓' : ''}</button>
          <span title="运行中=智能体正在处理回回合；已加载=内存驻留待命；冷却=仅持久化">状态</span>
          <span className="sh-row-num" title="上下文占用（窗口百分比）">占用</span>
          <span className="sh-row-num sh-dim" title="每轮输入计费当量（含缓存折扣）">输入</span>
          <span className="sh-row-num sh-dim" title="每轮输入费用（含缓存折扣，忙闲时价）">费用</span>
          <span className="sh-row-num" title="轮次 / 消息数">规模</span>
          <button type="button" className={`sh-col-head sh-row-num${sortMode === 'time' ? ' sh-sort-active' : ''}`} onClick={() => changeSort('time')} aria-label="按上次使用排序">活动{sortMode === 'time' ? '↓' : ''}</button>
        </div>
        <div className="sh-panel-list" ref={listRef}>
          {rows === null && loadError === null ? (
            <div className="sh-panel-empty">正在读取各上下文罗盘数据…</div>
          ) : rows === null ? (
            <div className="sh-panel-empty">加载失败：{loadError}</div>
          ) : rows.length === 0 ? (
            <div className="sh-panel-empty">没有可显示的会话</div>
          ) : (
            (pageRows ?? []).map(row => {
              const health = row.health
              const severity: HealthSeverity | 'unknown' = health?.severity ?? 'unknown'
              const pct = health?.ratio !== null && health?.ratio !== undefined
                ? Math.min(Math.round(health.ratio * 100), 100)
                : null
              const metaBits = [
                row.createdAt > 0 ? `创建于 ${ageOf(row.createdAt)}` : null,
                pct !== null ? `占用 ${pct}%` : '占用未知',
                health?.effectivePerRound !== null && health?.effectivePerRound !== undefined
                  ? `约 ${compact(health.effectivePerRound)} token/轮`
                  : null,
                health !== null ? `${health.turns} 轮 / ${health.userMessages + health.assistantMessages} 条` : null,
                health !== null && health.compactions > 0
                  ? `已压缩 ${health.compactions} 次${health.compressionRatio !== null && health.compressionRatio !== undefined ? `（上次压缩比例 ≈ ${Math.round(health.compressionRatio * 100)}%，快照口径）` : ''}`
                  : null,
                ACTIVITY_LABEL[row.status]?.meta ?? '冷会话',
              ].filter((v): v is string => v !== null)
              const ariaSev = severity === 'unknown' ? '未知' : SEVERITY_ARIA[severity]
              const wsLabel = row.workspace !== null ? row.workspace.title : '未分组'
              const scale = health !== null ? `${health.turns}轮/${health.userMessages + health.assistantMessages}条` : '—'
              const perRound = health?.effectivePerRound !== null && health?.effectivePerRound !== undefined
                ? compact(health.effectivePerRound)
                : '—'
              const occ = pct !== null ? `${pct}%` : '—'
              const cost = moneyOf(health, isZh)
              const titleText = `${row.title ?? '未命名会话'}[${wsLabel}]`
              const moveTip = (e: React.MouseEvent) => {
                setTip({ rowId: row.id, cx: e.clientX, cy: e.clientY })
              }
              // Flip below the pointer near the viewport top (header zone);
              // clamp horizontally so the label never leaves the screen.
              const tipBelow = tip !== null && tip.cy < 96
              const tipLeft = tip !== null ? Math.min(Math.max(tip.cx, 100), window.innerWidth - 100) : 0
              const tipTop = tip !== null ? (tipBelow ? tip.cy + 14 : tip.cy - 8) : 0
              return (
                <button
                  type="button"
                  key={row.id}
                  className={`sh-panel-row sh-grid-cols${severity !== 'unknown' ? ` sh-sev-${severity}` : ''}`}
                  onClick={() => openSession(row.id)}
                  onMouseEnter={moveTip}
                  onMouseMove={moveTip}
                  onMouseLeave={() => setTip(null)}
                  aria-label={`上下文罗盘：${ariaSev}。${titleText}。${metaBits.join('，')}。点击打开并运行 /compass`}
                >
                  {tip !== null && tip.rowId === row.id ? (
                    <span className={`sh-rowtip${tipBelow ? ' sh-rowtip-below' : ''}`} role="tooltip" style={{ left: tipLeft, top: tipTop }}>{titleText}</span>
                  ) : null}
                  <span className="sh-sev-chip"><span className="sh-row-dot" />{severity === 'unknown' ? '暂无数据' : SEVERITY_LABEL[severity]}</span>
                  <span className={`sh-row-${row.status ?? 'cold'}`} title={ACTIVITY_LABEL[row.status]?.tip ?? '仅持久化（未加载）'}>{ACTIVITY_LABEL[row.status]?.label ?? '冷却'}</span>
                  <span className="sh-row-num" title={pct !== null ? `上下文占用 ${pct}%` : undefined}>{occ}</span>
                  <span className="sh-row-num sh-dim" title={perRound !== '—' ? `每轮输入约 ${perRound} token（计费当量，含缓存折扣）` : undefined}>{perRound}</span>
                  <span className="sh-row-num sh-dim" title={cost !== null ? `每轮约 ${cost}（含缓存折扣，忙闲时价）` : undefined}>{cost ?? '—'}</span>
                  <span className="sh-row-num">{scale}</span>
                  <span className="sh-row-num sh-dim" title={updatedById[row.id]?.updatedAt !== undefined
                    ? `上次使用 ${dateFull(updatedById[row.id]!.updatedAt!)}；创建于 ${row.createdAt > 0 ? dateFull(row.createdAt) : '—'}`
                    : row.createdAt > 0 ? `创建于 ${dateFull(row.createdAt)}` : undefined}>{agoShort(updatedById[row.id]?.updatedAt, nowMs)}</span>
                </button>
              )
            })
          )}
        </div>
        <div className="sh-panel-foot">
          {rows !== null && rows.length > PAGE_SIZE ? (
            <span className="sh-pager">
              <button type="button" className="sh-pager-btn" disabled={page <= 0} onClick={() => gotoPage(page - 1)} aria-label="上一页">‹</button>
              <span className="sh-pager-info">{page + 1} / {pageCount}</span>
              <button type="button" className="sh-pager-btn" disabled={page >= pageCount - 1} onClick={() => gotoPage(page + 1)} aria-label="下一页">›</button>
            </span>
          ) : null}
          <span className="sh-foot-hint">每 5 秒刷新 · 点击行打开并运行 /compass · 点表头切换排序 · Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}

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

/**
 * Inject the badge stylesheet the client-modules way: a
 * `<style data-plugin="<id>">` tag on document.head. There is no 'styles'
 * service — in-tree bundles auto-inject CSS Modules as exactly such tags at
 * factory execution (tsdown preset `dsh-css-modules-inline`), and the module
 * system claims untagged tags on materialization while HMR removes
 * `style[data-plugin=<id>]` on unload. The data-plugin-css guard makes the
 * injection idempotent across plugin re-applies.
 */
function injectStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = 'dsh-context-compass/badge'
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}

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
