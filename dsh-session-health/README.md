# dsh-session-health

Session health for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a real-data "continue vs new session" indicator.

- **Header badge** — colored dot + border (green/yellow/red) next to the Session log button, styled with DSH theme tokens; hover shows advice, window-ratio progress bar, per-round token cost, and model window. Refreshes every 30s.
- **`/health` command** — full textual report with optional probes:
  - `/health` — everything
  - `/health minimal` — core metrics only
  - `/health no-git` / `/health no-handoff` — skip a probe
  - `/health doc=<你的文件名>` — check your own handoff document (no preset filename; the concept is yours, the name is yours)

## Why real data

Every signal comes from the harness itself — nothing is estimated:

| Signal | Source |
|---|---|
| Per-round input tokens | `ctx.tokenMeter` (exact measurement, snapshot caliber) |
| Context window | `llm.resolveModelInfo` (e.g. 1M for deepseek-v4-pro) |
| Messages / turns | `sessionQuery.listEvents` |
| Git repo? | `fs` probe of `.git` |
| Handoff doc | `fs` probe of the name *you* provide |

## Decision model

| Color | Condition | Advice |
|---|---|---|
| Green | window ratio < 50% and per-round < 50K | keep going |
| Yellow | ratio ≥ 50% or per-round ≥ 50K | consider wrapping at the next task boundary |
| Red | ratio ≥ 80% | wrap up soon |

Methodology derived from the community session-health skill (two-dimensional continue-vs-switch model); the harness version upgrades the data layer from estimation to exact measurement.

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

## Design

See [DESIGN.md](research/session-health-plugin/DESIGN.md（本仓库设计文档）) for the full design note (signal mapping, decision model, configurable checks, phase-2 roadmap: `session_health` tool, projection, process probe).

## License

MIT
