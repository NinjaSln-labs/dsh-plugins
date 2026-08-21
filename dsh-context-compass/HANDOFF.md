# HANDOFF.md — dsh-context-compass 工作交接

> 最后更新：2026-08-19 · 交接方：dsh web 会话（deepseek-v4-pro）· 一句话：**十二轮审计完结（51 fixed + 25 recorded），0.7.13 已发布，构建+冒烟+mount+client-mount+typecheck+visual 全绿（100 项），0 残留，0 待办**

## 1. 交接元信息

- **日期**：2026-08-19
- **插件包**：`dsh-context-compass@0.7.13`（npm latest），npm 用户名 `ninjasln`
- **交接原因**：会话切换（用户将 cd 到本目录继续）
- **文档入口链**：`README.md`（中英双语）→ `PUBLISHING.md`（发布记录）→ `docs/DESIGN.md`（设计）· `docs/ROADMAP.md`（路线图，唯一权威来源）· `docs/AUDIT-0.7.11.md`（审计）
- **接收方建议**：先读完本文件 §2–§3；路线图见 `docs/ROADMAP.md`（唯一权威来源）；发布前确认 `git rev-parse <tag> == git rev-parse HEAD`（见 pits：0.7.11 事故——tag 指向旧提交，版本守卫只比版本号字符串，放出了未审计代码）

## 2. 当前状态快照

### 2.1 版本与仓库

| 域 | 状态 |
|---|---|
| git 仓库 | `NinjaSln-labs/dsh-plugins`，`main` 分支，工作树干净，全部已提交 |
| origin 对齐 | 是（`main` 与 `origin/main` 无 ahead/behind） |
| npm latest | **0.7.13**（tag `context-compass-v0.7.13`，commit `c6bf93c`） |
| HEAD | `c6bf93c`（与 npm 一致） |
| 最近 tag | `context-compass-v0.7.13`（`c6bf93c`） |
| 发布管道 | `.github/workflows/publish.yml`——push `context-compass-v*` tag → CI 验证链（build+typecheck+smoke+mount+client-mount）→ `environment: npm-publish` 人工审批门 |
| pnpm workspace | 根 `pnpm-workspace.yaml`，依赖已装 |

### 2.2 功能与审计

| 域 | 状态 |
|---|---|
| 功能 | 完整：头部徽章（severity + 悬停浮层 + 缓存命中/压缩感知/计费预期）+ `/compass` 命令 + `context_compass` 工具 + sidebar 一览面板 + `/context-compass-rpc` 路由 |
| 审计 | **十二轮完成**：51 fixed + 25 recorded（0 残留），见 `docs/AUDIT-0.7.11.md`（八轮）+ 本会话第九~十二轮 |
| 占位/未完成 | **无**——功能完整，十二轮审计 0 残留，0.7.13 已发布 |

### 2.3 测试

| 套件 | 结果 |
|---|---|
| smoke | **83 项全绿**（`scripts/smoke.mjs`） |
| mount | ✅（host：/compass 命令、`context_compass` 工具、projection、RPC 路由） |
| client-mount | ✅（bundle 注册、report 解析、badge/浮层/面板插槽、样式注入） |
| typecheck | ✅（`tsc --noEmit` 无报错） |
| visual | **6/6 通过**（badge 浮层折叠+复制、panel 四档矩阵/暗色/分页/Esc/遮罩关闭） |

### 2.4 最近完成（摘要——详情在 commit message）

- `c6bf93c` release v0.7.13（十二轮审计后发布）
- `efe0cd5` 第九~十一轮：CSS reduced-motion / 运行时类型守卫 / 配置双源注释 / CNY remainingNote 覆盖
- `b05d9bc` 第八轮：负数 remainingRounds 按未提供归一化
- `fc55c96` 第七轮：pricing 大文档 Content-Length 上限防御（1MB）
- `542fa16` 第七轮：pricing fetch 超时（AbortError）降级用例
- `d6a96b2` 第七轮：overview workspaceRegistry 抛错降级 + healthView 边界用例
- `9a84382` 第七轮：windowPercent/交接摘要 pct 截断 100 + client CNY 走 formatCny
- `6dfc6b2`：ratio 显示截断 + title backend 失败 smoke 用例
- `aa48fd1` 第六轮：死代码清除 / 构建严格性对齐 / README 纠错
- `c39ae1d` 第五轮：onError 测试 + compactionRatio isFinite 全链对齐
- `b349f50` 第五轮：renderToolText 防御 / RPC 500 路径测试
- `ecffcda` 第五轮：外部读数 NaN/Infinity 拒绝 + 格式化纵深防御
- `ec6887c` 第五轮：可观测性 logger / 工具 schema 对齐 / 格式化单点化
- `652e9d7`：visual 适配 0.7.12——B2/B3 浮层测试 + 键盘序列 + 剪贴板权限
- `0f2eba3`：release v0.7.12（tag，npm published）

## 3. 下一步与验证点

### 3.1 已发布 ✅

0.7.13 已通过 CI 发布（push `context-compass-v0.7.13` tag → 验证链 → npm-publish 审批）。

### 3.2 重启验证（`dsh web` 重启 + 硬刷新）

- [ ] `/compass` 命令可用、`context_compass` 工具可见
- [ ] 徽章浮层「更多详情」折叠 + 复制摘要按钮
- [ ] 一览面板（sidebar 罗盘一览按钮）
- [ ] `/context-compass-rpc` 路由 200
- [ ] **processes 探测默认关闭**——`/compass` 需显式 `processes` 参数

### 3.3 风险提醒

- 改源码后必须 `npm run build` 重建 lib/ 再重启（bundle 读 lib/）
- bundle 在 boot 早期 apply，可选服务必须 `ctx.inject()` 等待（详见 imgdraw commit `249d7df` 同类修复）
- npm 版本不可变——发布务必确认 tag 指向 HEAD（0.7.11 旧代码事故已入 pits）
- 手工 `npm publish` 权限不足或被 `NODE_AUTH_TOKEN` 污染时可用 CLI 参数 `--//registry.npmjs.org/:_authToken=<token>`（优先于 `~/.npmrc`）

## 4. 即时操作

```bash
# 发布门禁（发布本版前跑，全绿才允许打 tag）
npm run release-check    # build + typecheck + smoke(83) + mount + client-mount + visual(6)
```

**已知坑**（未修，仍会踩）：
1. `pnpm peers check` 报缺 peer → **正常**（profile peers 经共享层解析）
2. 视觉测试只读不写卡（不再污染真实会话；`card.spec` 已删，见 pits）

**已修并已归档的坑**（详见 `../../HANDOFF-ARCHIVE/pits.md`）：
- 0.7.11 tag 指向旧提交（纪律已收入 §3.1）
- 服务方法解构丢 this（knowledge/agents `.call()` 保留 this）
- 面板点击行偶发「执行失败 aborted」（execute 移入 setTimeout）
- 卡片 metric 长文本出框（overflow-wrap + max-width 防御）
- visual 测试往真实会话写卡（已删 card.spec；套件只读）
- summary RPC 忽略用户配置（RPC 传 resolved config）

## 5. 引用索引

| 主题 | 路径 |
|---|---|
| **源码**（13 文件） | `src/`（index / assess / command / config / tool / projection / overview / knowledge / pricing / usage / util / schemas / types / client） |
| **测试** | `scripts/smoke.mjs`（83 项）· `scripts/mount.mjs` · `scripts/client-mount.mjs` · `visual/tests/{badge,panel}.spec.mjs`（6 项） |
| **审计** | `docs/AUDIT-0.7.11.md`（前八轮 44 fixed + 25 recorded）+ 本会话第九~十二轮（累计 51 fixed + 25 recorded） |
| **设计/路线** | `docs/DESIGN.md`（设计）· `docs/ROADMAP.md`（路线图，唯一权威来源）· `docs/OPTIMIZATION-RESEARCH.md`（优化调研）· `docs/RESEARCH-COMPETITORS.md`（竞品调研） |
| **发布记录** | `PUBLISHING.md`（版本历史 + CI 修复记录） |
| **功能文档** | `README.md` + `README.en.md`（中英双语） |
| **决策日志** | `docs/SESSION-LIST-DOT.md` |
| **发布管道** | `../.github/workflows/publish.yml`（context-compass 发布工作流） |
| **插件集总览** | `../README.md`（插件表） |
| **本机部署** | `~/.dsh/profiles/web/package.json` · `cordis.patch.yml` · `~/.dsh/settings.yaml` |
| **npm** | `https://www.npmjs.com/package/dsh-context-compass` |

## 6. 维护规则

- **更新时机**：版本变化、新坑、待办完成时更新 §2–§4；详细设计一律进 README（防双源），本文件只记 delta
- **防双源**——文档/README/PUBLISHING.md 已有的稳定知识引用路径，不复制；commit message 已有详情只记一行式 `[hash] 一句话标题`
- **滚动归档**：确认修复的坑迁 `../../HANDOFF-ARCHIVE/pits.md`；完成待办迁 `done.md`
- **脱敏**：不得写入 token/Key；凭据一律指向位置不写值
- **发布后来回填**：§2 快照同步（tag/commit/npm version/测试结果）+ 新的未修坑入 §4 + 确认已修迁归档
