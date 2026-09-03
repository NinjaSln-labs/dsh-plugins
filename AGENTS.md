# 本仓状态：已封版（archived）

本仓是 DSH 插件集的**历史存档**。2026-09 起全部插件已迁移为独立单库，各自管理开发-发布流程：

- https://github.com/NinjaSln-labs/dsh-context-compass
- https://github.com/NinjaSln-labs/dsh-knowledge-sqlite
- https://github.com/NinjaSln-labs/dsh-subagent-router
- https://github.com/NinjaSln-labs/dsh-subagent-cursor
- https://github.com/NinjaSln-labs/dsh-imgdraw
- https://github.com/NinjaSln-labs/dsh-session-slm-router

**硬性规则：**

1. **不要在本仓改动插件源码**——`dsh-*/` 目录是过时快照，改动不会构建、不会发布、不会进入任何单库。
2. 插件的开发、构建、部署、发版一律在对应单库进行，遵循各单库自己的 AGENTS.md / DEVELOPMENT.md。
3. 本仓的发布流程（GitHub Actions workflows、check:deploy、根级 workspace、pre-commit 部署自检）已于封版时删除，勿引用、勿重建。
4. 本仓仅保留：过时快照目录、pricing/、历史 tag 与 `standalone-*` / `dev/*` 分支、迁移文档（DSH-PLUGIN-STANDALONE-MIGRATION.md）。
