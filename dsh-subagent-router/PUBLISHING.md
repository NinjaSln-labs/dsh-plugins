# 发布记录：dsh-subagent-router

**已发布**（GitHub + npm）：`dsh-subagent-router@0.1.1`（latest，git CI 自动发布）。旧名 `dsh-subagent-model-picker`（0.1.0 / 0.1.1）已 deprecate 指向本包。

## 发布状态（2026-08-15 更新）

| 项 | 状态 |
|---|---|
| npm | ✅ `dsh-subagent-router@0.1.1`（latest，CI 自动发布 run completed success）· `0.1.0`（手动首发 bootstrap） |
| GitHub | ✅ `NinjaSln-labs/dsh-plugins` main，tag `subagent-router-v0.1.1` |
| 旧包 | ✅ `dsh-subagent-model-picker` 0.1.0/0.1.1 deprecated（Renamed to dsh-subagent-router） |
| profile | ✅ `~/.dsh/profiles/web` 已装 0.1.1（依赖 `dsh-subagent-router@^0.1.0`，pnpm update） |
| 发布管道 | ✅ tag → 版本守卫 → 验证链 → 人工审批 → publish（0.1.1 首次跑通） |

## 版本历史

- **0.1.1** — **git 自动发布管道首次跑通**：
  - 发布流程：`npm version patch --no-git-tag-version`（工作树脏时 npm 的自动 commit/tag 会被跳过）→ 手动 commit + 打 `subagent-router-v0.1.1` tag → push → GitHub 审批（environment `npm-publish`）→ CI publish
  - 管道修复的两个 CI 坑（详见 `../../HANDOFF-ARCHIVE/pits.md`）：
    1. workflow step name `Guard: tag version...` 冒号 = invalid YAML，GitHub 静默失败 run 从不触发发布——加引号修复（`85dcb70`，顺带修好 context-compass 的 publish.yml）
    2. setup-node `cache: npm` 找不到 lockfile（本仓库 pnpm lock 不入库）→ Setup Node 直接失败——去掉 `cache: npm`（`1402b97`）

- **0.1.0** — **新包名首发（手动 bootstrap）**：
  - 背景：更名 `dsh-subagent-model-picker` → `dsh-subagent-router`（picker 低估了路由+auto 策略的功能面）；granular token 选不到未发布包，需手动首发
  - 手动 `npm publish`（token `ninjasln`）→ 包上线后建立限权 granular token → NPM_TOKEN secret → 后续版本走 git 管道
  - 旧包 deprecate：`dsh-subagent-model-picker@0.1.0/0.1.1` → 「Renamed to dsh-subagent-router」

- **0.1.0–0.1.2（旧名 dsh-subagent-model-picker，已 deprecate）**：
  - v0.1.0 — 首发：`subagent_model` / `subagent_models` 两个工具（显式 provider/model/max_tokens）
  - v0.1.1 — `model: "auto"` 自动选型（任务分档 → 目录打分 → 失败升级 → 可审计）
  - v0.1.2 — auto 策略锚定父模型（默认沿用父模型，重任务弱父升强，升级只升不降）

## 发布流程（日常）

```bash
cd dsh-plugins/dsh-subagent-router
npm version patch --no-git-tag-version -m "chore: release v%s"
git add package.json && git commit -m "chore: release v$(node -p "require('./package.json').version")"
git tag subagent-router-v$(node -p "require('./package.json').version")
git push && git push --tags    # CI 验证 → GitHub 审批 → 自动 publish
```

## 维护规则

- 每个新版本发布后在本文件追加一条版本历史（一行式 + 关键细节），并在 `HANDOFF.md` §2 同步快照
- 发布一律走 git 管道，不用手工 `npm publish`（bootstrap 例外仅限新包名首发）
