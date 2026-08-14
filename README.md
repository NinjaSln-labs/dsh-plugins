# DSH Plugins

Community plugin collection for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). All plugins are public and installable via `dsh plugin add <name>`.

[English](README.md) | [中文](README.zh.md)

## Plugins

| Plugin | Package | Status |
|---|---|---|
| [dsh-session-health](./dsh-session-health) | session health v0.5.1: reactive badge (projection-driven), `/health` command, `session_health` tool, official peak/off-peak dual-currency pricing (CNY/USD, jsdelivr + GitHub-raw fallback), cache-aware window-scaled economy tier, automated handoff checklist | published (GitHub + npm) |
| [dsh-knowledge-sqlite](./dsh-knowledge-sqlite) | cross-session knowledge: `ctx.knowledge` + `knowledge_*` tools, FTS5 trigram + L1 query expansion (V1.11 contract) | published (GitHub + npm) |

## Conventions

- One plugin per directory, each a standalone npm package (`dsh.bundle` manifest)
- Install: `dsh plugin add <package-name>`
- Discover: [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic on this repo
- Keep repos sanitized: no local paths, no secrets, noreply git email
- READMEs are bilingual: `README.md` (English) + `README.zh.md` (中文)
