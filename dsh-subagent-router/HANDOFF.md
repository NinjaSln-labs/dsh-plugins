# HANDOFF.md — dsh-subagent-router 工作交接

> 最后更新：2026-08-21 · 交接方：dsh web 会话（deepseek-v4-flash）· 一句话：**v0.1.1 已发布（git CI 管道跑通），健康感知（失败分类脱敏透传 + 死锚检测 + 终态换路 + 升级参数化 + 目录健康标注）+ 模型路由优先级配置化（四层组合）已落地，61/61 测试全绿（含审计修复：other 瞬态信号、换路沿用配置），README 对齐 compass（中文主版 + 徽章 + 元数据），0 待办（源码改动未发布）**

## 1. 交接元信息

- **日期**：2026-08-15
- **插件包**：`dsh-subagent-router@0.1.1`（npm latest），npm 用户名 `ninjasln`
- **交接原因**：会话切换（用户将 cd 到本目录继续）
- **文档入口链**：`README.md`（中文主版）+ `README.en.md`（英文）→ `PUBLISHING.md`（发布记录）→ `docs/ROADMAP.md`（路线图，唯一权威来源）
- **接收方建议**：先读完本文件 §2–§3；路线图见 `docs/ROADMAP.md`（唯一权威来源）；发布流程见本文件 §4 与工作流头部注释；本文件位于插件目录（与 context-compass 同款），工作区根 `HANDOFF.md` 只记 delta 并引用本文件

## 2. 当前状态快照

### 2.1 版本与仓库

| 域 | 状态 |
|---|---|
| git 仓库 | `NinjaSln-labs/dsh-plugins`，`main` 分支，工作树干净 |
| npm latest | **0.1.1**（tag `subagent-router-v0.1.1`，经 git CI 自动发布） |
| 版本历史 | 0.1.0（手动首发 bootstrap）→ 0.1.1（CI 管道首次跑通）；旧名 `dsh-subagent-model-picker` 0.1.0/0.1.1 已 deprecate 指向新包 |
| 发布管道 | `.github/workflows/publish-subagent-router.yml`——push `subagent-router-v*` tag → 版本守卫 → 验证链（strict typecheck + 30 测试 + build）→ `environment: npm-publish` 人工审批门（与 context-compass 共用） |
| pnpm workspace | 根 `pnpm-workspace.yaml` 已含本包；lockfile 不入库 |

### 2.2 功能

| 域 | 状态 |
|---|---|
| 功能 | 完整：`subagent_model` 工具（每次委派显式 provider/model/max_tokens + `model: "auto"` 内置路由策略）+ `subagent_models` 目录工具 |
| auto 策略 | 锚定父模型（默认，`anchored` 标记）→ 任务分档（trivial/standard/complex）→ 重任务弱父升强（目录最强）→ 失败升级（只升不降，`autoEscalate` + `autoEscalationTiers`）→ 全程可审计（`[auto]` 行 + reason） |
| 健康感知（新增，未发布） | 失败分类脱敏透传（quota/rate-limit/auth/context/server/timeout/transport + HTTP status/retry-after）· 死锚检测（父路由不健康不再锚定，`RouteHealthStore` 60s TTL）· 终态失败换路（`autoReroute`，quota/auth 换健康 provider）· 目录健康标注（`health`/`failingClass`/`retryAfterSec`） |
| 路由优先级配置化（新增，未发布） | `autoProviderOrder`（供应商优先级）+ `autoTierPolicy`（每档 anchor/cheapest/strongest）+ `autoTierPicks`（每档显式候选序，可跨 provider）+ `autoCeiling`（预算封顶）——用户可按自己对供应商的性价比认知配置，插件不再替用户做主 |
| 占位/未完成 | **无**——功能完整，0 待办（见 §3） |

### 2.3 测试

| 套件 | 结果 |
|---|---|
| vitest | **61/61 全绿**（`tests/tools.spec.ts`，真实 ToolRuntime+SubagentRuntime + 脚本化 provider + fake llm 路由；含 auto 策略、锚定、升级、防降级、失败分类、健康存储、死锚换路、瞬态升级、多档阶梯、详情透传、目录标注、优先级配置四层、other 瞬态信号、换路沿用配置用例） |
| typecheck | ✅（`tsc -p tsconfig.json --noEmit` 严格通过） |
| build | ✅（`tsc -p tsconfig.build.json` → `lib/`；新增 `failure.js`/`health.js` 已入 `files`） |
| CI 实跑 | ✅ 0.1.1 发布 run completed success（Guard → Install → Verify → Publish 全过） |

### 2.4 最近完成（摘要——详情在 commit message）

- `5212562` docs: 插件本地文档（HANDOFF + ROADMAP + PUBLISHING，context-compass 格式）
- **健康感知 + 配置化（未提交，工作树）**：src/failure.ts + src/health.ts 新增；tools.ts/index.ts 增强；package.json files 补 failure/health
- **审计修复（未提交，工作树）**：`record('other')` 改为瞬态信号（死锚检测对模型层 stopReason:'error' 生效）· `rerouteToHealthy` 换路沿用 autoTierPicks/autoTierPolicy + signal 中止检查 + 失败详情透传不再吞 · 死代码清理（anchorScore/SubagentStartRequest/pickByMode anchor 分支）· 重复代码抽 helper（buildFailureAggregate/unhealthyReason）· 跨 provider picks 目录失败时 models 置空防旧目录污染 ladder
- `85deb80` docs: 新增 ROADMAP.md（三阶段计划）
- `1402b97` ci: 去掉 setup-node `cache: npm`（无 lockfile 报错，见 pits）
- `85dcb70` ci: step name 冒号加引号（invalid YAML，见 pits；顺带修好 context-compass 的 publish.yml）
- `e6f2f1a` refactor: 更名 dsh-subagent-model-picker → dsh-subagent-router
- `9ac18cd` feat: v0.1.2 锚定父模型策略（更名前最后提交，旧名）
- `9020424` feat: v0.1.1 model:"auto"（旧名）
- `2c6484f` feat: v0.1.0 首发（旧名）

## 3. 下一步与验证点

### 3.1 已发布 ✅

0.1.1 已通过 CI 发布（push `subagent-router-v0.1.1` tag → 验证链 → npm-publish 审批）。npm `latest=0.1.1`，registry 已确认。

### 3.2 重启验证（`dsh web` 重启 + 硬刷新）

- [ ] `subagent_model` 工具可见（描述含 `model: "auto"` 说明与健康感知）
- [ ] `model: "auto"` 实测：琐碎任务锚定父模型（`[auto] ... anchored`）、重任务弱父升强、失败自动升档
- [ ] `model: "auto"` 健康感知实测：父路由被标记不健康（quota/auth 失败）后不再锚定、换到健康 provider；失败详情带分类与 HTTP 状态（如 `provider rate-limited (http 429)`）
- [ ] `subagent_models` 目录工具可见，且输出每个 provider 带 `health`/`failingClass`/`retryAfterSec`
- [ ] 配置化实测：profile 里配 `autoProviderOrder`/`autoTierPolicy`/`autoTierPicks`/`autoCeiling` 后重启，auto 决策按配置生效（`[auto]` 行 reason 带 `policy=` 标注）；不配时行为与旧版一致

### 3.3 风险提醒

- 改源码后必须 `pnpm run build` 重建 lib/ 再重启（bundle 读 lib/）
- 工作树有未提交改动时 `npm version` 的自动 commit/tag 会被跳过 → 用 `--no-git-tag-version` + 手动 commit/tag（工作流头部注释已写）
- npm 版本不可变——发布前确认 tag 指向 HEAD
- 手工 `npm publish` 权限不足时用 CLI 参数 `--//registry.npmjs.org/:_authToken=<token>`（优先于 `~/.npmrc`）

## 4. 即时操作

```bash
# 测试 / 构建
pnpm test && pnpm run build

# 发布（新版本时，git 管道）
npm version patch --no-git-tag-version -m "chore: release v%s"
git add package.json && git commit -m "chore: release v$(node -p "require('./package.json').version")"
git tag subagent-router-v$(node -p "require('./package.json').version")
git push && git push --tags    # → CI 验证 → GitHub 审批（environment npm-publish）→ 自动 publish
```

**已知坑**（未修，仍会踩）：
1. `npm version`（不带 `--no-git-tag-version`）在工作树脏时跳过 commit/tag，只改版本号——**解法见上**
2. `pnpm peers check` 报缺 peer → **正常**（profile peers 经共享层解析）
3. `~/.npmrc` 旧 token 会压过 `NODE_AUTH_TOKEN`——手工发布用 CLI 参数

**已修并已归档的坑**（详见 `../../HANDOFF-ARCHIVE/pits.md`）：
- workflow step name 冒号 = invalid YAML（GitHub 静默生成失败 run，从不触发发布）
- setup-node `cache: npm` 需要 lockfile（本仓库 lockfile 不入库 → Setup Node 直接失败）

## 5. 引用索引

| 主题 | 路径 |
|---|---|
| **源码** | `src/index.ts`（入口/生命周期/config）· `src/tools.ts`（两个工具 + auto 策略 + 失败恢复）· `src/failure.ts`（失败分类/脱敏）· `src/health.ts`（路由健康存储） |
| **测试** | `tests/tools.spec.ts`（61 项） |
| **路线图** | `docs/ROADMAP.md`（唯一权威来源） |
| **发布记录** | `PUBLISHING.md` |
| **功能文档** | `README.md` + `README.en.md`（中英双语，中文主版） |
| **发布管道** | `../.github/workflows/publish-subagent-router.yml` |
| **插件集总览** | `../README.md`（插件表） |
| **本机部署** | `~/.dsh/profiles/web/package.json`（依赖+bundles）· `~/.dsh/settings.yaml` |
| **npm** | `https://www.npmjs.com/package/dsh-subagent-router` |

## 6. 维护规则

- **更新时机**：版本变化、新坑、待办完成时更新 §2–§4；详细设计一律进 README / docs（防双源），本文件只记 delta
- **防双源**——README/ROADMAP/PUBLISHING 已有的稳定知识引用路径，不复制；commit message 已有详情只记一行式 `[hash] 一句话标题`
- **滚动归档**：确认修复的坑迁 `../../HANDOFF-ARCHIVE/pits.md`；完成待办迁 `done.md`
- **脱敏**：不得写入 token/Key；凭据一律指向位置不写值
- **发布后来回填**：§2 快照同步（tag/commit/npm version/测试结果）+ 新的未修坑入 §4 + 确认已修迁归档
