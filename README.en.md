# DSH Plugins

[简体中文](README.md) | English

Community plugin collection for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). All plugins are public npm packages, installable via `dsh plugin add <name>`.

## Plugins

| Plugin | Package | Status |
|---|---|---|
| [dsh-session-health](./dsh-session-health) | session health v0.6.0: reactive badge (projection-driven), `/health` command, `session_health` tool, multi-session health overview panel ("健康一览" sidebar action listing every session's verdict via loopback RPC), official peak/off-peak dual-currency pricing (CNY/USD, jsdelivr + GitHub-raw fallback), theme-adaptive severity palette, cache-aware window-scaled economy tier, money/token cost toggle, automated handoff checklist | published (GitHub + npm) |
| [dsh-knowledge-sqlite](./dsh-knowledge-sqlite) | cross-session knowledge: `ctx.knowledge` service + `knowledge_*` tools, SQLite FTS5 trigram index + L1 query expansion (V1.11 contract, zero-LLM writes, instantly searchable) | published (GitHub + npm) |
| [dsh-subagent-router](./dsh-subagent-router) | model-routed subagent delegation: `subagent_model` tool with per-call provider/model/max_tokens overrides + built-in `model: "auto"` routing policy (anchored to the parent's own model; task-tier upgrades, failure escalation, auditable reason) + `subagent_models` catalog tool | published (GitHub + npm) |
| [dsh-imgdraw](./dsh-imgdraw) | text-to-image v0.1.0: `draw_image` tool, input-bar 生图 button + popup (async generation, 4-grid results, download / keep / delete), `/imgdraw` image route, persisted history; DashScope wan2.7-image free by default, SiliconFlow Qwen-Image optional | in development (bundle done · unpublished) |

## Conventions

- One plugin per directory, each a standalone npm package (`dsh.bundle` manifest)
- Install: `dsh plugin add <package-name>`
- Discover: [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic on this repo
- Keep repos sanitized: no local paths, no secrets, noreply git email
- Root README is Chinese-first: `README.md` is the Chinese version, `README.en.md` the English one; per-plugin READMEs keep the two-file pattern (`README.md` English + `README.zh.md` Chinese)

## Development Process (mandatory)

**All plugin development must follow the agile iteration process**: [DEVELOPMENT.md](./DEVELOPMENT.md)

- User stories first (experience-driven) → one feature per iteration → Definition of Done all green before shipping → ship & try immediately → retrospective
- Dynamic-plugin pitfall cheatsheet in the appendix (client-half completeness, sandbox-banned globals, contract preflight, event formats, etc.)
