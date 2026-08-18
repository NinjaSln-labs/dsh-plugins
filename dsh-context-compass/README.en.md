# dsh-context-compass

[简体中文](README.md) | English

Context compass for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a real-data "continue vs new session" indicator.

- **Header badge** — a colored dot + pill (green/blue/yellow/red) next to the session-log button, styled with DSH theme tokens. **Reactive**: driven entirely by the host-computed `sessionHealth` projection (push frames — the only online data path community plugins own; the client Remote list is build-time fixed, so this plugin has no Remote and no polling). Hover shows the advice, a window-occupancy bar, per-round token cost and **cache-hit rate** (a sign of context stability; compaction resets it), compaction-aware **expected next input (cache reads excluded)**, **expected cost (money)** (CNY on zh interfaces, USD otherwise — official peak/valley pricing, marked `忙时价/闲时价`), model window, session scale and compaction count (with the **last compression ratio** — inferred from the pressure-snapshot delta around a fold, labeled "snapshot caliber"). When the verdict lags behind a compaction (severity rides pre-compaction pressure while the occupancy bar already reflects the next request), the tooltip notes "**下次请求后更新**". **Click to run `/compass`** for the full report. Keyboard accessible.
- **`/compass` command** — a full textual report with optional probes:
  - `/compass` — everything (git / handoff doc / process probes, configurable)
  - `/compass minimal` — core metrics only (token / window / scale)
  - `/compass no-git` / `/compass no-handoff` — skip one probe family
  - `/compass doc=<your.file>` — check YOUR handoff document (no filename is assumed; the concept is yours, the name is yours)
  - `/compass remaining=<rounds>` — cost expectation (money): `per-round cost × remaining rounds ≈ expected input spend` (cache-discounted)
  - `/compass processes` — force the process probe
- **`context_compass` tool** — a read-only model-callable assessment (long-task self-check): structured verdict (`severity` / `recommendation` / `signals` / `cost` / `handoffReady`), with a full markdown report attached on yellow/red. Work-nature questions are self-assessed by the model (`dependsOnEarly` / `earlyDecisionRecorded` / `remainingRounds`); everything else is measured exactly by the host.
- **`sessionHealth` projection** — a host-computed persistent fold (turns, message counts, compaction count, last-wins pressure/window, last-request cache buckets, **last compression ratio**, severity + advice) pushed to every client; survives replay and page refresh.
- **Multi-session overview panel** (v0.6.0) — the "罗盘一览" button beside Settings at the sidebar foot opens a full-screen panel (`shell.overlay`) listing **every session's** verdict. Data rides a same-origin host RPC (`/context-compass-rpc`, loopback only): live sessions read the projection-registry snapshot, cold sessions read the persisted projection cache (async cold load fallback); titles come from log folds / batch queries. Rows sort red → yellow → blue → green → no-data (then **running > loaded > cold** inside a tier, then newest first); the panel refreshes every 5 s while open; clicking a row opens that session and runs `/compass`. The status column is tri-state — **运行中** (agent actively processing a turn, the same signal as the sidebar's 进行中), **已加载** (materialized but idle), **冷却** (persisted only). Esc / scrim click closes. Keyboard and screen-reader accessible (severity is never conveyed by color alone).
- **压缩比例与滞后标注**（v0.7.0）— the fold infers the last compression ratio (1 − post/pre from pressure snapshots around `compaction/end`, no event payload; inconclusive folds read null, never a fake 0) and surfaces it with the "snapshot caliber" label in the advice, report, tool signals and panel tooltips. When the severity verdict (last-wins pressure) diverges from the occupancy bar (compaction-aware next-request cost) by ≥5 pp after a compaction, the tooltip annotates the lag until the next request refreshes the verdict.

## Handoff checklist (automated)

On yellow/red, `/compass` appends a **real-state checklist** instead of static copy: `git status --short` / `git log --oneline -1` / `git status -sb` (read-only whitelisted argv through `ctx.subprocess`) drive the commit/push items, the handoff-doc probe drives the doc item, the process probe drives the process item. Items that cannot be checked are marked `[ ]` with the reason — never silently shown as "done".

## Decision model

Two-dimensional "continue vs switch" (community session-health methodology), parameterized in the plugin config:

| Tier | Condition (default) | Advice |
|---|---|---|
| Green | window ratio < 30%, per-round billable < 50K | Keep going |
| Blue | ratio 30–50%, or messages ≥ 800 (proxy) | Continue, watch the window |
| Yellow | ratio ≥ 50%, or per-round billable ≥ max(50K, 30% × window) | Wrap up at the next task boundary |
| Red | ratio ≥ 80% | Wrap up and hand off soon |

Per the methodology, the economy dimension (per-round billable, cache-discounted) outranks capacity (window ratio). The economy floor scales with the window (`economyWindowRatio`): the 50K absolute default was calibrated for ~128K-window models, and using it raw on large-window models would false-yellow at single-digit occupancy — now the billable equivalent must actually meet the floor. When the work depends on early content that was never recorded (git/docs), the tool escalates to `danger-zone` — it never suggests a naked switch.

## Configuration

```ts
// thresholds: decision-model parameters
thresholds: {
  windowMid: 0.3, windowHigh: 0.5, windowCritical: 0.8,   // window-ratio tiers
  economyTokenFloor: 50000, economyWindowRatio: 0.3,      // economy: billable ≥ max(50K, 30%×window) → yellow
  economyRoundFloor: 10,                                  // remaining-rounds threshold (cost-expectation copy)
  messageCountProxy: 800,                                 // context-bloat proxy metric
}
// checks: probe switches (all read-only)
checks: {
  git: { enabled: true, workspaceRoot?: string },          // .git existence probe
  handoff: { enabled: true, paths: [] },                   // YOUR handoff-doc filenames
  sessionResume: { enabled: true },                        // DSH persistence note
  processes: { enabled: true },                            // ps probe through ctx.subprocess
}
projection: { enabled: true }                              // reactive badge unit
cost: {
  cacheHitDiscount: 0.1,       // cache-hit price ratio
  inputPricePerM: 0.28,        // static fallback: USD per 1M input tokens
  priceSource: 'auto',         // 'auto': periodic fetch; 'static': never
  priceUrl: 'https://cdn.jsdelivr.net/gh/NinjaSln-labs/dsh-plugins@main/pricing/deepseek.json',   // primary (jsdelivr, reachable in CN)
  priceFallbackUrl: 'https://raw.githubusercontent.com/NinjaSln-labs/dsh-plugins/main/pricing/deepseek.json', // same-cycle fallback (GitHub raw)
  priceRefreshHours: 24,
}
```

## Pricing (money display)

The harness carries no price data; money display resolves through a live cache fed by the **official DeepSeek pricing document** (default `priceUrl` = jsdelivr CDN mirror, `priceFallbackUrl` = GitHub raw, same-cycle fallback; the document is the repo-maintained [`pricing/deepseek.json`](../../../pricing/deepseek.json), kept in sync with [api-docs.deepseek.com](https://api-docs.deepseek.com/quick_start/pricing/)). When the primary source is unreachable (some networks block GitHub raw) it falls back automatically instead of degrading the money display to static USD.

- **Peak/valley**: each read picks the period by **Beijing time** — peak 9:00–12:00 / 14:00–18:00 (the English page writes UTC 01–04 / 06–10), off-peak half price; the badge marks `忙时价/闲时价`.
- **Per model**: priced by the current model name (`models."*"` fallback). **Both official currencies** — CNY from the Chinese page, **USD taken directly from the English page** (no FX conversion): v4-flash off-peak miss ¥1.5/M / $0.22/M, hit ¥0.05/M / $0.007/M; peak ¥3.0/M / $0.44/M, ¥0.10/M / $0.014/M.
- **Currency by region**: CNY when the app UI is zh, USD otherwise; `/compass` shows both.
- Refreshed every `priceRefreshHours` (default 24h); failures keep the last good document; before the first success (or with `priceSource: 'static'`) the static `inputPricePerM` / `cacheHitDiscount` apply (flat USD, no periods).

Document format (both currencies required per period):
`{ "peakHours": [[9,12],[14,18]], "models": { "<model>": { "peak": { "inputMissPerMCny": 3.0, "inputHitPerMCny": 0.10, "inputMissPerMUsd": 0.44, "inputHitPerMUsd": 0.014 }, "offpeak": { ... } }, "*": { ... } } }`

## Why real data

Every signal comes from the harness itself — no estimation:

| Signal | Source |
|---|---|
| Per-round input tokens | `ctx.tokenMeter.measure` (exact, snapshot caliber) |
| Context window | `llm.resolveModelInfo` (e.g. deepseek-v4-pro's 1M) |
| Messages / turns / compactions / cache buckets / compression ratio | `sessionHealth` projection fold (sessionQuery fallback; ratio = in-fold 1 − post/pre pressure snapshot, snapshot caliber) |
| Next-request occupancy | token-meter `contextPressure.projectedTokens` (compaction-aware) |
| Git repo + worktree state | `fs` probe + read-only git subcommands |
| Handoff doc | probes **the filename you provide** |
| Running processes | read-only `ps` probe through `ctx.subprocess`, filtered to the workspace |

## Install

```sh
dsh plugin add dsh-context-compass
# then restart / reload the profile that mounts it
```

Or add it to a profile patch layer:

```yaml
# your profile cordis.patch.yml
- insert:
    - id: session-health
      name: 'dsh-context-compass'
```

## Development

```sh
npm run build      # tsc → lib/ + esbuild client bundle
npm run typecheck  # strict type check
npm run smoke      # logic smoke tests (stub services)
npm run mount      # real cordis mount test (command + tool + projection)
npm run build:client && node scripts/client-mount.mjs  # browser boot-path test
npm run visual     # Playwright visual regression (needs a running harness: light/dark × four tiers × card matrix + hover-bridge e2e)
npm run visual:update  # rewrite baselines after an intentional visual change (visual/baselines/)
```

## Design

Methodology derives from the community session-health skill (the two-dimensional continue-vs-switch model); the harness version upgrades the data layer from estimation to exact measurement. Full design notes (signal mapping, decision model, configurable checks, roadmap) live in the plugin dev workspace at `research/session-health-plugin/DESIGN.md`.

## License

MIT