# DSH Plugins

## ⭐ Originality Statement

All plugins are **developed in-house from scratch** — not an aggregation or repackaging of third-party plugins.

[简体中文](README.md) | English

A collection of personally developed plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): session health, cross-session knowledge, subagent model routing, and AI image generation. All plugins are installable via `dsh plugin add <name>`.

## Plugins

| Plugin | Package | Status |
|---|---|---|
| [dsh&#8209;session&#8209;health](./dsh-session-health) | **Session Health v0.6.0**:<br>· reactive badge (projection-driven) + `/health` command + `session_health` tool<br>· multi-session health overview panel ("健康一览")<br>· official peak/off-peak dual-currency pricing (CNY/USD, jsdelivr + GitHub-raw fallback)<br>· theme-adaptive severity palette · cache-aware window-scaled economy tier<br>· money/token cost toggle · automated handoff checklist | ✅ published (GitHub + npm) |
| [dsh&#8209;knowledge&#8209;sqlite](./dsh-knowledge-sqlite) | **Cross-session Knowledge v0.1.2**:<br>· `ctx.knowledge` service + `knowledge_*` tools<br>· SQLite FTS5 trigram index + L1 query expansion (V1.11 contract)<br>· zero-LLM writes · instantly searchable | ✅ published (GitHub + npm) |
| [dsh&#8209;subagent&#8209;router](./dsh-subagent-router) | **Model-routed Delegation v0.1.1**:<br>· `subagent_model`: per-call provider/model/max_tokens overrides<br>· built-in `model: "auto"` routing policy (anchored to parent · task-tier upgrade · failure escalation · auditable)<br>· `subagent_models` catalog tool | ✅ published (GitHub + npm) |
| [dsh&#8209;imgdraw](./dsh-imgdraw) | **Text-to-Image v0.1.0**:<br>· `draw_image` tool + input-bar 生图 button/popup (async generation · 4-grid · download/keep/delete)<br>· `/imgdraw` image route · persisted history<br>· backends: DashScope wan2.7-image free default · SiliconFlow Qwen-Image optional | 🚧 in development (bundle done · unpublished) |

## Development Process (mandatory)

**All plugin development must follow the agile iteration process**: [DEVELOPMENT.md](./DEVELOPMENT.md)

- User stories first (experience-driven) → one feature per iteration → Definition of Done all green before shipping → ship & try immediately → retrospective
- Dynamic-plugin pitfall cheatsheet in the appendix (client-half completeness, sandbox-banned globals, contract preflight, event formats, etc.)
