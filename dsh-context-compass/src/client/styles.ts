/** dsh-context-compass — client styles (extracted from the monolith entry). */
export const CSS = `
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
/* R1 占用趋势 sparkline：占用行下方的迷你折线（主题色随 severity accent）。 */
.sh-spark{display:block;width:110px;height:18px;margin:2px 0 4px auto;color:var(--sh-accent,var(--dsw-alias-label-secondary));opacity:.85;overflow:visible}
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

/** Package id — must match package.json `name` (injectStyles uses it for the style tag). */
const name = 'dsh-context-compass'

/** Inject the badge stylesheet the client-modules way (see entry docs). */
export function injectStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = 'dsh-context-compass/badge'
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}
