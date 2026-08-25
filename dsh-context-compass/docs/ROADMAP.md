# dsh-context-compass — Roadmap

状态基准：**v0.7.17**（2026-08-25 发布）。本文件是路线图的**唯一权威来源（单源）**；`HANDOFF.md` / `DESIGN.md` / `OPTIMIZATION-RESEARCH.md` 只记录 delta 并引用本文件，不复制路线内容。

## 已交付（到 v0.7.17）

### 第一波（插件侧，无核心依赖）

- **CI 自动发布** — tag `context-compass-v*` 触发 → 验证链（build/smoke/mount/client-mount + 版本守卫）→ environment `npm-publish` 人工审批 → `npm publish`
- **多上下文罗盘一览面板** — `sidebar.footer.action` + `shell.overlay` + `/context-compass-rpc`（loopback-only）；红→黄→蓝→绿→未知排序，5s 刷新，点击行 open + /compass
- **`/compass` 富卡片** — `conversation.chat.commandview`，severity chip + 结论 + 指标 + 交接清单 + 可折叠全文
- **压缩比例量化** — 快照差值推断（1 − 压缩后/压缩前），标「快照口径」
- **压缩后判定滞后标注** — `lagOf` 纯函数，≥5pp 分叉且压缩后提示
- **视觉回归** — Playwright 明/暗 × 四档 × 分页 + 徽章 hover 桥接层 e2e

### 第二波

- **浮层信息分层（B2）** — 「更多详情」折叠次要行（窗口/规模）
- **交接摘要一键复制（B3）** — 浮层底部动作，RPC 取真实摘要 → 剪贴板
- **economyRoundFloor 接入判定（A3）** — 工具/命令 `remainingRounds ≥ floor` 且经济命中时升一档
- **messageCountProxy 随窗口缩放（A4）** — `max(proxy, ratio × window)`

### 第三波（部分）

- **知识库联动（解耦版 D2）** — `/compass` 报告尾部结构化交接快照段 + 可选探测 `ctx.get('knowledge')` 跨会话回顾；写回留给用户显式 `knowledge_write`

### 质量

- **十二轮审计**：51 fixed + 25 recorded（0 残留）
- **100 项自动化测试全绿**：83 smoke + 4 mount + 7 client-mount + 6 visual

### 稳定性基建（0.8.0 先行落地）

- **S0 本地发布门禁** — `scripts/release-check.mjs` 一条命令收敛完整验证链（build/typecheck/smoke/mount/client-mount/visual），任一失败 exit 1 禁发
- **S1 live 契约检查** — `scripts/contract-check.mjs` 对运行中 harness 断言插件挂载 + 注入链路（RPC 路由判别：404 漂移 / 400 活着 / 200 服务链可用）；已并入 release-check；**rc.8 升级体检通过**
- **R2 压缩触发频率** — 「已压缩 N 次」补「平均每 X 轮一次」（`compactIntervalRounds` 纯函数，防除零；投影 view advice 全档位追加）
- **rc.7→rc.8 升级** — 仅实质变化为移除 dead 声明 `dsh-client-ui-primitives`（`client.tsx` 从不 import），已清理；4 硬注入 + 全部可选读取 + 3 client slot 形状无漂移

### 一览面板周期（0.7.14 → 0.7.17）

- **性能重构（0.7.16/0.7.17）** — 双缓存 + 活动列 + RPC 时延断言；listSessions 缓存 TTL 2.5s→6s（对齐 5s 轮询间隔）→ stale-while-revalidate（过期帧立即返回旧列表 + 后台刷新，任何帧不等慢查询）；contract-check 加冷启动预热重试豁免。实测轮询帧 **≤20ms**（冷启动首帧唯一例外）
- **排序规则重构（0.7.15）** — **运行中置顶** → 组内红→黄→蓝→绿 → 非运行中同梯 → 已加载>冷却 → 新在前（host+client 双侧同规则）
- **排版精修（0.7.15）** — 列宽按实测内容定宽、数字列表头右对齐、次要列降灰、修 8px 容器错位；视觉基线随更新（darwin + linux 双平台入库）

## 待做（按优先级）

> 主线目标：**发布稳定、不影响体验**。顺序原则：稳定性基建 > 零风险功能 > 需兼容测试的功能 > 需先调研设计的大项。

### 稳定性基建（保证发布稳定）

> S0（本地发布门禁）已交付，见「已交付」。

| # | 项 | 优先级 | 动机 / 价值 | 依赖 |
|---|---|---|---|---|
| S2 | **stateVersion 向后兼容测试**（旧 state 折进当前 view，断言无 crash/NaN） | P1 | 加 sparkline 需 bump stateVersion，防旧缓存踩坑 | — |
| S3 | **配置生效冒烟**（每个 config 字段改动可观测到行为变化） | P1 | 堵配置静默失效 | — |
| S4 | **canary 发布通道**（`next` tag → 本地实测 → promote `latest`） | P2 | 新版本先灰度再全量 | — |

### 配置点接入（⚠️ 需深入调研与设计）

> rc.7 新增 `ctx.settings` 插件配置点：Host 注册 settings 命名空间 + Client 在 `settings.plugin.item` 槽注册卡片，设置 UI 直接调参。**本项尚未落到可执行设计——先调研再定稿，未定稿前不动工。**

| # | 项 | 优先级 | 动机 / 价值 | 依赖 |
|---|---|---|---|---|
| C1 | **Host 侧接入 `installSettingsSection`**（getter 模式，配置 live 可读 + 消除 V11-1 双源） | P2 | 配置单一权威 + settings 文档驱动；顺带治愈 resolveConfig 双源 | `@deepseek-ai/dsh-settings`（rc.7）；先调研投影/工具/命令三处改 getter 的准确范围、`applies: live/restart` 取舍、peer 升级影响 |
| C2 | **Client 配置卡片**（`settings.plugin.item` keyed 自建） | P3 | 设置 UI 直接调参 | C1；场外插件不可复用内置控件（bundle 门禁），需自建表单 + 草稿暂存 + revision 设栅；先调研卡片契约与构建要求 |

### 功能项

| # | 项 | 优先级 | 动机 / 价值 | 依赖 |
|---|---|---|---|---|
| R1 | **占用趋势 sparkline**（浮层「上下文占用」行下方） | P1 | 竞品空白；一眼看出稳步上升 vs 压缩后回落 | 投影加 `pressureHistory`（stateVersion 8→9）+ 客户端 SVG/CSS 渲染；**需 S2 兼容测试先就绪** |
| R3 | **定价同步自动化（C4）** | P2 | `pricing/deepseek.json` 手动同步 → CI 定时对比官方、变更开 PR | GitHub Actions 定时 job |
| R4 | **session-health 技能阈值回写（D1）** | P2 | 插件阈值与技能默认参数已分叉，需对齐 | 技能侧配合 |
| R5 | **轮次语义细化（A5）** | P3 | 区分多工具调用的回合：「轮次 X / 步数 Y」 | 投影加 step 计数 |
| R6 | **多币种 / 实时汇率** | P3 | 收益低、外部依赖脆，暂缓 | 外部汇率源 |

## 被阻塞（需 harness 或跨仓库配合）

| # | 项 | 卡点 |
|---|---|---|
| B1 | 会话列表每行健康点（见 `SESSION-LIST-DOT.md`） | harness 需声明 `session.row.trailing` slot；无源码做不了 |
| B2 | 知识库自动写回（D2 强联动） | dsh-knowledge-sqlite 需开放公开、带门控的写入服务（跨仓库协作）|

## 排期建议

| 版本 | 内容 |
|---|---|
| ~~0.7.14~~ | 已跳过该排期——0.7.14–0.7.17 实际交付：R2 压缩频率 + S0/S1 稳定性基建 + 一览面板性能重构与排序/排版精修（见「已交付」）|
| **0.8.0** | S2 stateVersion 兼容测试 + S3 配置生效冒烟（S4 canary 可选）——稳定性基建收尾 |
| **0.9.0** | R1 sparkline（S2 就绪后）· C1 host 配置点接入（调研定稿后）|
| **0.10.x** | C2 client 配置卡片 |
| **后续** | R3 / R4 / R5 / R6 · B1 / B2（等依赖就绪）|

## 维护规则

- 本文件是路线图的**唯一权威来源**；完成一项 → 从「待做」移到「已交付」并标注落地版本
- 被阻塞项保留在「被阻塞」并写明卡点；卡点解除后移回「待做」
- 优先级/排期变化只改这里；`HANDOFF.md` / `DESIGN.md` / `OPTIMIZATION-RESEARCH.md` 引用本文件、不复制路线内容
- **peer 基线策略**：`peerDependencies` 声明"最低要求的服务版本"，保持宽松、不随 harness 每次升级而升。caret `^0.1.0-rc.6` 语义自动覆盖 rc.6→rc.8（`>=0.1.0-rc.6 <0.2.0`，下限是 prerelease 故匹配 prerelease；semver 已验 `rc.8 satisfies ^0.1.0-rc.6`）。仅当接入依赖更高版本独有 API 时**局部**升对应服务（例：C1 接入 `@deepseek-ai/dsh-settings`，需 rc.7+），不全局升
- **升级体检基线（S1 依据）**：每次 harness 升级，对照 live 契约校验插件硬注入（commands / tools / sessionProjections / webServer）+ 全部 `ctx.get` 可选读取 + client slot（sidebar.footer.action / shell.overlay / conversation.chat.commandview）是否仍存在、形状是否兼容。rc.8 本次校验通过（见 commit `9b98c07` 前后）