# dsh-session-health

[English](README.md) | [中文](README.zh.md)

Session health for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a real-data "continue vs new session" indicator.

- **Header badge** — colored dot + border (green/blue/yellow/red) next to the Session log button, styled with DSH theme tokens. **Reactive**: driven entirely by the host-computed `sessionHealth` projection (push frames — the one wire path community plugins own; client Remotes are a fixed generated list, so no Remote, no polling). Hover shows advice, window-ratio bar, per-round token cost with **cache-hit rate** (hit rate reflects context stability; compactions reset it), compaction-aware **next-input estimate (cache hits excluded)**, **per-round cost in USD** (`cost.inputPricePerM`, default $0.28/M; cache hits × `cost.cacheHitDiscount`), model window, session scale, and compaction count. **Click runs `/health`** for the full report. Keyboard-accessible.
- **`/health` command** — full textual report with optional probes:
  - `/health` — everything (git / handoff / process probes, configurable)
  - `/health minimal` — core metrics only (token / window / scale)
  - `/health no-git` / `/health no-handoff` — skip a probe
  - `/health doc=<your-file>` — check your own handoff document (no preset filename; the concept is yours, the name is yours)
  - `/health remaining=<rounds>` — cost expectation in USD: `per-round cost × remaining rounds ≈ expected input spend` (cache-discounted)
  - `/health processes` — force the process probe
- **`session_health` tool** — model-callable read-only assessment for long tasks: structured verdict (`severity`, `recommendation`, `signals`, `cost`, `handoffReady`) plus a full markdown report at yellow/red tiers. The model self-checks the work-nature questions (`dependsOnEarly` / `earlyDecisionRecorded` / `remainingRounds`); the host measures everything else.
- **`sessionHealth` projection** — durable host-computed fold (turns, messages, compactions, last-wins pressure/window, last-request cache buckets, severity + advice) pushed to every client; survives replay and page reloads.

## Handoff checklist (automated)

When yellow/red, `/health` appends a **real-state checklist** instead of static prose: `git status --short` / `git log --oneline -1` / `git status -sb` (read-only whitelisted argv via `ctx.subprocess`) drive the commit/push items, the handoff probe drives the doc item, and the process probe drives the process item. Uncheckable items are marked `[ ]` with the reason — never silently "done".

## Decision model

Two-dimensional continue-vs-switch (community session-health methodology), parameterized in plugin config:

| Severity | Condition (defaults) | Advice |
|---|---|---|
| Green | window ratio < 30%, per-round < 50K | keep going |
| Blue | ratio 30–50%, or messages ≥ 800 (proxy) | keep going, watch the window |
| Yellow | ratio ≥ 50% or per-round ≥ 50K | wrap at the next task boundary |
| Red | ratio ≥ 80% | wrap up soon, hand off |

Economy (absolute per-round cost) outranks capacity (window ratio), per the methodology. The tool escalates to `danger-zone` when the work depends on early content that was never recorded (git/docs) — never suggest a blind switch there.

## Configuration

```ts
// thresholds: decision-model parameters
thresholds: {
  windowMid: 0.3, windowHigh: 0.5, windowCritical: 0.8,   // window-ratio tiers
  economyTokenFloor: 50000, economyRoundFloor: 10,        // economy dimension
  messageCountProxy: 800,                                  // context-bloat proxy
}
// checks: probe switches (all read-only)
checks: {
  git: { enabled: true, workspaceRoot?: string },          // .git existence probe
  handoff: { enabled: true, paths: [] },                   // your handoff doc names
  sessionResume: { enabled: true },                        // DSH persistence note
  processes: { enabled: true },                            // ps probe via ctx.subprocess
}
projection: { enabled: true }                              // reactive badge unit
cost: { cacheHitDiscount: 0.1, inputPricePerM: 0.28 }      // cache-hit price fraction + USD input price per 1M tokens
```

## Why real data

Every signal comes from the harness itself — nothing is estimated:

| Signal | Source |
|---|---|
| Per-round input tokens | `ctx.tokenMeter.measure` (exact, snapshot caliber) |
| Context window | `llm.resolveModelInfo` (e.g. 1M for deepseek-v4-pro) |
| Messages / turns / compactions / cache buckets | `sessionHealth` projection fold (sessionQuery fallback) |
| Next-request occupancy | token-meter `contextPressure.projectedTokens` (compaction-aware) |
| Git repo + worktree state | `fs` probe + read-only git subcommands |
| Handoff doc | `fs` probe of the name *you* provide |
| Running processes | `ctx.subprocess` read-only `ps` probe, workspace-filtered |

## Install

```sh
dsh plugin add dsh-session-health
# then restart / reload the profile that mounts it
```

Or add to a profile overlay:

```yaml
# your profile cordis.patch.yml
- insert:
    - id: session-health
      name: 'dsh-session-health'
```

## Development

```sh
npm run build      # tsc → lib/ + esbuild client bundle
npm run typecheck  # strict typecheck
npm run smoke      # logic smoke tests (stub services)
npm run mount      # real-cordis mount test (command + tool + projection)
npm run build:client && node scripts/client-mount.mjs  # browser-boot path test
```

## Design

Methodology derived from the community session-health skill (two-dimensional continue-vs-switch model); the harness version upgrades the data layer from estimation to exact measurement. The full design note (signal mapping, decision model, configurable checks, phase-2 roadmap) lives in the plugin development workspace at `research/session-health-plugin/DESIGN.md`.

## License

MIT
