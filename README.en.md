# DSH Plugins (Archived)

> **⚠️ This repository was frozen (archived) in September 2026.**
> All plugins have migrated to **standalone repositories** for development and release. The plugin directories under this repo are **outdated historical snapshots** kept for archival purposes only.
> **Do not submit any plugin changes here** — there is no build, deploy, or release pipeline left in this repository.

[简体中文](README.md) | English

## New homes (standalone repos)

All further development, issues, and releases happen in each plugin's standalone repository:

| Plugin | Repository | Description |
|---|---|---|
| dsh-context-compass | https://github.com/NinjaSln-labs/dsh-context-compass | Context-usage visualization + session handoff |
| dsh-knowledge-sqlite | https://github.com/NinjaSln-labs/dsh-knowledge-sqlite | Cross-session knowledge retrieval (SQLite FTS5) |
| dsh-subagent-router | https://github.com/NinjaSln-labs/dsh-subagent-router | Subagent provider/model routing |
| dsh-subagent-cursor | https://github.com/NinjaSln-labs/dsh-subagent-cursor | Cursor-as-subagent provider via @cursor/sdk |
| dsh-imgdraw | https://github.com/NinjaSln-labs/dsh-imgdraw | draw_image tool + input-bar image generation |
| dsh-session-slm-router | https://github.com/NinjaSln-labs/dsh-session-slm-router | Weak-model grayscale routing (experimental) |

## What remains here

- `dsh-*/` plugin directories: **historical snapshots** from the migration; they may lag behind the standalone repos and are kept for archival only
- `pricing/`: historical pricing data source (context-compass now ships its own copy)
- Historical tags and `standalone-*` / `dev/*` branches: anchors of the subtree-split migration, kept permanently
- The standalone-migration methodology lives in `DSH-PLUGIN-STANDALONE-MIGRATION.md` at the ecosystem root (outside this repo, not tracked)

## Historical install (outdated, for legacy environments only)

```bash
dsh plugin add dsh-context-compass    # published npm package, independent of this repo
```

Installations follow the npm packages; this repository's contents are no longer kept in sync with npm releases.

## Originality Statement

All plugins are **developed in-house from scratch** — not an aggregation or repackaging of third-party plugins. Each plugin's statement and LICENSE live in its standalone repository.
