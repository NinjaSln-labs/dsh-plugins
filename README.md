# DSH Plugins

Community plugin collection for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). All plugins are public and installable via `dsh plugin add <name>`.

[English](README.md) | [中文](README.zh.md)

## Plugins

| Plugin | Package | Status |
|---|---|---|
| [dsh-session-health](./dsh-session-health) | session health v0.5.6: reactive badge (projection-driven), `/health` command, `session_health` tool, official peak/off-peak dual-currency pricing (CNY/USD, jsdelivr + GitHub-raw fallback), theme-adaptive severity palette, cache-aware window-scaled economy tier, money/token cost toggle, automated handoff checklist | published (GitHub + npm) |
| [dsh-knowledge-sqlite](./dsh-knowledge-sqlite) | cross-session knowledge: `ctx.knowledge` + `knowledge_*` tools, FTS5 trigram + L1 query expansion (V1.11 contract) | published (GitHub + npm) |
| [dsh-subagent-model-picker](./dsh-subagent-model-picker) | model-chosen subagent delegation: `subagent_model` tool with per-call provider/model/max_tokens overrides + `subagent_models` catalog tool | published (GitHub + npm) |

## Conventions

- One plugin per directory, each a standalone npm package (`dsh.bundle` manifest)
- Install: `dsh plugin add <package-name>`
- Discover: [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic on this repo
- Keep repos sanitized: no local paths, no secrets, noreply git email
- READMEs are bilingual: `README.md` (English) + `README.zh.md` (中文)
