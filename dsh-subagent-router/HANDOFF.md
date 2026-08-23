# HANDOFF.md — dsh-subagent-router 工作交接

> 最后更新：2026-08-21 · 交接方：dsh web 会话（deepseek-v4-flash）· 一句话：**v0.1.1 已发布；本会话完成健康感知 + 配置化四层 + 设置页配置 UI（host+client 化）并全量实测通过，已提交（`bd3a403..4b4d4d6` 五个提交），66/66 测试全绿，待发版（0.2.0）**

## 1. 交接元信息

- **日期**：2026-08-21
- **插件包**：npm latest 仍为 `dsh-subagent-router@0.1.1`（本会话改动已提交但未发版）；npm 用户名 `ninjasln`
- **交接原因**：本会话完成三大功能块（健康感知/配置化/设置页 UI）并实测，交接到新会话（发版或继续 1a/1c/1d/1e）
- **文档入口链**：`README.md`（中文主版）+ `README.en.md`（英文）→ `PUBLISHING.md`（发布记录）→ `docs/ROADMAP.md`（路线图，唯一权威来源）→ `docs/PLAN-settings-ui.md`（设置页 UI 实施计划与验收标准，已完成）
- **接收方建议**：先读本文件 §2–§3；发版走 §4 命令；改 client 后**浏览器刷新即生效**（无需重启 dsh），改 host 后需重启；本文件位于插件目录，工作区根 `HANDOFF.md` 只记 delta

## 2. 当前状态快照

### 2.1 版本与仓库

| 域 | 状态 |
|---|---|
| git 仓库 | `NinjaSln-labs/dsh-plugins`，`main` 分支；**本插件工作树干净**（另一插件 dsh-subagent-cursor 的工作树有它自己的未提交改动，与本插件无关） |
| npm latest | **0.1.1**（tag `subagent-router-v0.1.1`）——**落后于 main**，本会话 5 个提交待发版 |
| 本会话提交 | `bd3a403`（pnpm workspace 修复，另一进程）→ `77249fb` settings-page config UI（host+client 化）→ `0356c8e` 卡片样式对齐+可折叠 → `304a237` i18n+保存/放弃修改 → `4b4d4d6` 排版/按钮/皮肤对齐内置卡片。注意：另一进程曾 rebase，旧 hash（`1c46f1e` 等）已变，以内容为准 |
| 发布管道 | `.github/workflows/publish-subagent-router.yml`——push `subagent-router-v*` tag → 版本守卫 → 验证链（strict typecheck + 测试 + build）→ `environment: npm-publish` 人工审批门 |
| pnpm workspace | 根 `pnpm-workspace.yaml` 已含本包；lockfile 不入库；`.pnpm-store/` 已 gitignore |

### 2.2 功能

| 域 | 状态 |
|---|---|
| 委派工具 | 完整：`subagent_model`（显式 provider/model/max_tokens + `model: "auto"` 路由策略）+ `subagent_models` 目录 |
| auto 策略 | 锚定父模型（`anchored`）→ 任务分档（trivial/standard/complex）→ 弱父升强 → 失败升级（`autoEscalate` + `autoEscalationTiers`，只升不降，多档阶梯）→ 可审计（`[auto]` 行 + `policy=` 标注） |
| 健康感知 | 失败分类脱敏透传（quota/rate-limit/auth/context/server/timeout/transport + HTTP status/retry-after）· 死锚检测（父路由不健康不锚定，`RouteHealthStore`：quota/auth 终态、其余含 `other` 60s TTL）· 终态失败换路（`autoReroute`，沿用 autoTierPicks/autoTierPolicy，signal 中止检查，失败详情不吞）· 目录健康标注 |
| 路由优先级配置化 | `autoProviderOrder` + `autoTierPolicy` + `autoTierPicks`（可跨 provider）+ `autoCeiling`——四层组合，都不配 = 旧行为 |
| **设置页配置 UI** | **插件 host+client 化**：host `installSettingsSection` 注册 `subagent-router` 命名空间（settings user 层 > patch.yml base > schema 默认，响应式 getter 实时生效）；client `settings.plugin.item` 卡片（`ctx.settingsScope.bind`，20 字段表单，中文文案，可折叠 header，保存/放弃修改 draft 模式）；样式与内置卡片（终端/Agent循环/网页搜索）逐项对齐（token 驱动，深浅色自适应）——**已实测：设置 → 插件配置 可见可编辑，保存后下一次调用即生效（无需重启）** |
| 占位/未完成 | **无**——功能完整（ROADMAP 1a/1c/1d 余项/1e 为增强项，见 §3） |

### 2.3 测试与构建

| 套件 | 结果 |
|---|---|
| vitest | **66/66 全绿**（真实 ToolRuntime+SubagentRuntime；含 auto 策略、健康感知、配置四层、settings 集成、失败恢复用例） |
| typecheck | ✅ 严格通过（host + client，tsconfig 已加 DOM lib + jsx） |
| build | ✅ `tsc`（host 8 文件 + config）+ `scripts/build-client.mjs`（esbuild → `lib/client.js`，`__ModuleLoader__` 注册） |
| 真实环境实测 | ✅ 本会话完成：锚定/显式委派/complex 升强（真实 harness）；设置页可见/编辑/保存实时生效（playwright + subagent_model 双向验证） |

### 2.4 最近完成（一行式——详情在 commit message）

- `4b4d4d6` style: 卡片排版/按钮/皮肤对齐内置插件卡片（token 驱动，双主题）
- `304a237` feat: 设置卡片中文化 + 保存/放弃修改（draft 模式）
- `0356c8e` fix: 卡片样式对齐内置 + 默认收起（header/chevron/aria-expanded）
- `77249fb` feat: 设置页配置 UI——插件 host+client 化（settings 命名空间 + plugin.item 卡片 + 打包链）
- `bd3a403` chore: pnpm workspace 修复（另一进程，含 allowBuilds）
- 更早：`5212562` docs（插件本地文档）· `85deb80` ROADMAP · `1402b97`/`85dcb70` CI 双坑（已归档）

## 3. 下一步与验证点

### 3.1 立即待办

- [ ] **发版 0.2.0**（本会话全部改动已提交未发布）：走 §4 命令；发版前确认 profile 的 `package.json` 依赖从 `file:` 改回 npm 版本号（当前是 `file:/Users/sin/.../dsh-subagent-router` 本地链接，见 §4 坑 4）
- [ ] ROADMAP 1a：`backgroundMode: continuable` 运行时实测（P0，唯一未实测的路径）
- [ ] ROADMAP 1c：目录元数据（cost 档/速度/上下文窗口）——推荐引擎（2a）的地基
- [ ] ROADMAP 1d 余项：档位阈值参数化、maxCost 预算
- [ ] ROADMAP 1e：真实 provider 配额耗尽场景实测（clinepass 类）

### 3.2 外部依赖来源

- npm 发布凭据：`~/.npmrc`（旧 token 会压过 `NODE_AUTH_TOKEN`，手工发布用 CLI 参数，见 §4 坑 3）
- 本机部署：`~/.dsh/profiles/web/`（`package.json` 依赖 + bundles；`settings.yaml` 是 settings user 层存储——**设置页 UI 写入的就是它的 `subagent-router` 段**）

### 3.3 风险提醒

- **另一进程会动同一仓库/profile**：本会话多次遇到（工作树被 stash、profile package.json 被重写移除本插件依赖、git rebase 改 hash）。接手后先 `git log --oneline -5` + 检查 profile 依赖是否还在，再动手
- 改 host 源码后：`pnpm run build` 重建 lib/ → 重启 dsh web；**改 client（client.tsx/纯 CSS）后：只需 build + 浏览器刷新**（lib/client.js 是 pnpm file: 硬链接，自动同步）
- 工作树脏时 `npm version` 跳过 commit/tag → 用 `--no-git-tag-version` + 手动 commit/tag
- npm 版本不可变——发布前确认 tag 指向 HEAD
- playwright 视觉验证脚本**绝不能点主题切换按钮**（会持久化到 settings.yaml 污染用户环境；本会话踩过，已恢复）

## 4. 即时操作

```bash
# 测试 / 构建（host + client）
pnpm test && pnpm run build

# 发布（新版本时，git 管道）
npm version patch --no-git-tag-version -m "chore: release v%s"   # 0.2.0 建议 minor
git add package.json && git commit -m "chore: release v$(node -p "require('./package.json').version")"
git tag subagent-router-v$(node -p "require('./package.json').version")
git push && git push --tags    # → CI 验证 → GitHub 审批 → 自动 publish

# 本机部署（发版前用 file: 链接，已配置）
cd ~/.dsh/profiles/web && pnpm install   # 从本地目录同步新构建
# 改 client 后只需浏览器刷新；改 host 后重启 dsh web
```

**已知坑**（未修，仍会踩）：
1. `npm version`（不带 `--no-git-tag-version`）脏工作树跳过 commit/tag——解法见上
2. `pnpm peers check` 报缺 peer → **正常**（profile peers 经 dsh 主程序共享层解析）
3. `~/.npmrc` 旧 token 压过 `NODE_AUTH_TOKEN`——手工发布用 CLI 参数
4. **profile 依赖可能被另一进程重写**：`~/.dsh/profiles/web/package.json` 曾被移除 `dsh-subagent-router` 依赖/bundles——发现插件消失时，把 `"dsh-subagent-router": "file:/Users/sin/Documents/dsh-ecosystem/dsh-plugins/dsh-subagent-router"` 加回 dependencies + bundles 数组，再 `pnpm install`
5. **client 插件必须命名导出**：`export const name/inject` + `export function apply`，且 `inject: ['slots', 'settingsScope']`——用 `export default { apply }` 会运行时报 `cannot get property "slots" without inject`
6. **host 的 installSettingsSection 不要加外层服务存在性判断**：`if (ctx.get('settings'))` 在服务未就绪时跳过注册且不会补——`installSettingsSection` 内部 `ctx.inject` 自己等待服务，无条件调用即可
7. **pnpm store 冲突**：仓库内 `.pnpm-store/`（另一进程建的）与全局 store 冲突时，本插件装依赖用 `npm install --no-save`（一次性装齐所有需要的包，避免多次 install 互相覆盖 node_modules）
8. **playwright 视觉验证不得点主题按钮**（持久化污染 settings.yaml）——测皮肤用只读方式

**已修并已归档的坑**（详见 `../../HANDOFF-ARCHIVE/pits.md`）：
- workflow step name 冒号 = invalid YAML
- setup-node `cache: npm` 需要 lockfile
- `record('other')` 被健康存储丢弃（死锚检测对模型层失败失效）——已改为瞬态信号
- `rerouteToHealthy` 未沿用配置/吞错误——已修（换路沿用配置 + 失败详情透传）

## 5. 引用索引

| 主题 | 路径 |
|---|---|
| **源码** | `src/index.ts`（host 入口/settings 注册/响应式 config）· `src/tools.ts`（工具 + auto 策略 + 失败恢复）· `src/failure.ts`（失败分类/脱敏）· `src/health.ts`（路由健康存储）· `src/client.tsx`（设置页卡片：表单/draft/样式）· `src/config.ts`（Config schema，与 resolveConfig 双源同步） |
| **打包链** | `scripts/build-client.mjs`（esbuild → `lib/client.js`）· `package.json`（`exports["./client"]` + `dsh.client.inject`） |
| **设置页 UI 计划** | `docs/PLAN-settings-ui.md`（实施计划 + 验收标准，已完成） |
| **测试** | `tests/tools.spec.ts`（66 项） |
| **路线图** | `docs/ROADMAP.md`（唯一权威来源） |
| **发布记录** | `PUBLISHING.md` |
| **功能文档** | `README.md` + `README.en.md`（中英双语，中文主版） |
| **发布管道** | `../.github/workflows/publish-subagent-router.yml` |
| **插件集总览** | `../README.md`（插件表） |
| **本机部署** | `~/.dsh/profiles/web/package.json`（依赖+bundles）· `~/.dsh/settings.yaml`（settings user 层——设置页写入处） |
| **npm** | `https://www.npmjs.com/package/dsh-subagent-router` |
| **机制参考**（dsh 主程序内，只读） | `dsh-bash-local`（installSettingsSection 先例）· `dsh-client-ui-settings-plugins`（BashCard/PluginCard）· `dsh-client-ui-settings`（SettingsScopeBinder：client `settingsScope` 服务） |

## 6. 维护规则

- **更新时机**：版本变化、新坑、待办完成时更新 §2–§4；详细设计一律进 README / docs（防双源），本文件只记 delta
- **防双源**——README/ROADMAP/PUBLISHING/PLAN 已有的稳定知识引用路径，不复制；commit message 已有详情只记一行式 `[hash] 一句话标题`
- **滚动归档**：确认修复的坑迁 `../../HANDOFF-ARCHIVE/pits.md`；完成待办迁 `done.md`
- **脱敏**：不得写入 token/Key；凭据一律指向位置不写值
- **发布后来回填**：§2 快照同步（tag/commit/npm version/测试结果）+ 新的未修坑入 §4 + 确认已修迁归档
