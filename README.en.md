# DSH Plugins

## ⭐ Originality Statement

All plugins are **developed in-house from scratch** — not an aggregation or repackaging of third-party plugins.

[简体中文](README.md) | English

A collection of personally developed plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): context compass, cross-session knowledge, subagent model routing, Cursor-as-subagent, and AI image generation. All plugins are installable via `dsh plugin add <name>` (npm-published plugins only).

## Plugins

| Plugin | Package | Status |
|---|---|---|
| [dsh&#8209;context&#8209;compass](./dsh-context-compass) | **Context Compass v0.11.0**:<br>· reactive badge (projection-driven) + `/compass` command + `context_compass` tool<br>· **settings integration** (v0.10.0): thresholds/probe toggles take effect live (badge flips on the next frame, no restart)<br>· occupancy-trend sparkline in the tooltip (last ≤40 per-request pressure samples)<br>· multi-session context overview panel ("罗盘一览"): running-first sorting · activity column · SWR polling (frames ≤20ms)<br>· official peak/off-peak dual-currency pricing (CNY/USD, jsdelivr + GitHub-raw fallback)<br>· theme-adaptive severity palette · cache-aware window-scaled economy tier<br>· compaction cadence hint (compacted N times · ~every X rounds)<br>· money/token cost toggle · automated handoff checklist · one-click handoff summary copy<br>· knowledge-base integration (decoupled, optional cross-session review)<br>· rich-card timestamp labels · layered popup (summary/details) · proxy window scaling<br>· client modularization (v0.11.0)<br>· AUDIT-0.10.0 fix batch (v0.11.0)<br>· canary release channel (v0.11.0)<br>· peer `^0.1.1-rc.2` (v0.11.0) | ✅ published (GitHub + npm) |
| [dsh&#8209;knowledge&#8209;sqlite](./dsh-knowledge-sqlite) | **Cross-session Knowledge v0.1.6**:<br>· `ctx.knowledge` service + `knowledge_*` tools<br>· SQLite FTS5 trigram index + L1 query expansion (V1.11 contract)<br>· L1 expansion cache persistence · explicit reasoning-chain off for expansion<br>· zero-LLM writes · instantly searchable | ✅ published (GitHub + npm) |
| [dsh&#8209;subagent&#8209;router](./dsh-subagent-router) | **Model-routed Delegation v0.3.0**:<br>· `subagent_model`: per-call provider/model/max_tokens overrides<br>· built-in `model: "auto"` routing (anchored to parent · task-tier upgrade · failure escalate/reroute · health-aware dead-anchor detection · auditable)<br>· routing priorities (provider order · tier policy · tier picks) — pickers from the live catalog, no hand-typed ids<br>· **settings-page config UI** (6 live options, live without restart)<br>· `subagent_models` catalog tool (with provider health + derived model metadata cost/speed/contextWindow) | ✅ published (GitHub + npm) |
| [dsh&#8209;subagent&#8209;cursor](./dsh-subagent-cursor) | **Cursor-as-subagent v0.1.0**:<br>· registers a `ctx.subagents` provider (default `cursor`) via `@cursor/sdk`<br>· one-shot local · summary-first result presentation · Profile Bundle | 🚧 in development (unpublished) |
| [dsh&#8209;imgdraw](./dsh-imgdraw) | **Text-to-Image v0.1.0**:<br>· `draw_image` tool + input-bar 生图 button/popup (async generation · 4-grid · download/keep/delete)<br>· `/imgdraw` image route · persisted history<br>· backends: DashScope wan2.7-image free default · SiliconFlow Qwen-Image optional | 🚧 in development (bundle done · unpublished) |

## Development Process (mandatory)

**All plugin development must follow the agile iteration process**: [DEVELOPMENT.md](./DEVELOPMENT.md)

- User stories first (experience-driven) → one feature per iteration → Definition of Done all green before shipping → ship & try immediately → retrospective
- Dynamic-plugin pitfall cheatsheet in the appendix (client-half completeness, sandbox-banned globals, contract preflight, event formats, etc.)
