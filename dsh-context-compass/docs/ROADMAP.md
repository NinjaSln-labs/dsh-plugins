# dsh-context-compass — Roadmap

状态基准：**v0.11.0**（2026-08-27 发布，npm latest）。本文件是路线图的**唯一权威来源（单源）**；`HANDOFF.md`（本地私有未追踪，不入仓库）/ `DESIGN.md` / `OPTIMIZATION-RESEARCH.md` 只记录 delta 并引用本文件，不复制路线内容。

## 已交付（到 v0.11.0）

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
- **117 项自动化测试全绿**：107 smoke + 4 mount + 7 client-mount + 6 visual（0.11.0 时点复核）

### 稳定性基建（0.8.0 先行落地）

- **S0 本地发布门禁** — `scripts/release-check.mjs` 一条命令收敛完整验证链（build/typecheck/smoke/mount/client-mount/visual），任一失败 exit 1 禁发
- **S1 live 契约检查** — `scripts/contract-check.mjs` 对运行中 harness 断言插件挂载 + 注入链路（RPC 路由判别：404 漂移 / 400 活着 / 200 服务链可用）；已并入 release-check；**rc.8 升级体检通过**
- **R2 压缩触发频率** — 「已压缩 N 次」补「平均每 X 轮一次」（`compactIntervalRounds` 纯函数，防除零；投影 view advice 全档位追加）
- **rc.7→rc.8 升级** — 仅实质变化为移除 dead 声明 `dsh-client-ui-primitives`（`client.tsx` 从不 import），已清理；4 硬注入 + 全部可选读取 + 3 client slot 形状无漂移

### 0.8.0 稳定性基建收尾

- **S2 stateVersion 向后兼容测试** — 语义基线入账（harness 持久化行带 ver，不匹配即丢弃全量重放）；v7 形状旧 state + 退化/异形 JSON 矩阵（空/null/NaN/负数/越界/非整/多余字段）折进 view 断言无 crash/NaN 且通过 strict wire schema；真实 `SessionProjectionRegistry` 集成测试（ver 不匹配行被丢弃、匹配行出 view 即合法）；wire payload 键集合稳定守卫。**顺带修真 bug**：`healthView` 原样透传 state 字段，旧 JSON state 字段缺失/null 会在冷加载 `schema.parse` 崩——加 wire 边界防御收口（finite/countOrZero coercion）；投影单元补**双契约兼容**（顶层 `view` + `wire`，0.1.1+ 与 rc.6 各取所需）
- **S3 配置生效冒烟** — 每个可调 config 字段的「改动 → 可观测行为变化」断言：8 个 thresholds（severity 边界/经济门槛窗口缩放/消息代理缩放/A3 升级门槛）+ 5 个 checks 开关（git/handoff/handoff.paths/sessionResume/knowledge/processes）+ cost（cacheHitDiscount/inputPricePerM/priceSource/priceUrl/priceFallbackUrl/priceRefreshHours 刷新周期捕获）+ projection.enabled 接线开关（mount：禁用后投影单元不注册）
- **测试规模** — 100 项 → smoke 100（+11）+ mount 5（+1）+ client-mount 7 + visual 6

### 0.9.0 占用趋势

- **R1 占用趋势 sparkline** — 投影加 `pressureHistory` 环形采样（每次带 inputTokens 的 usage 报告一个样本，封顶最近 40 个；stateVersion 8→9：旧行丢弃全量重放重建趋势，S2 套件兜底）；浮层「上下文占用」行下方 SVG 迷你折线（归一口径：优先除以当前窗口=逼近满窗趋势，窗口未知除以序列峰值只看形状；少于 2 点隐藏；主题色随 severity accent）；view 边界过滤非有限/负数遗留样本
- **测试规模** — smoke 104（+4 R1：追加/封顶/退化过滤/version bump 守卫）+ mount 5 + client-mount 7 + visual 6

### 0.10.0 配置点接入（C1）

- **C1 host 配置点** — `installSettingsSection(ctx, 'context-compass', Config, entry, hooks)`（设计定稿 `C1-SETTINGS-DESIGN.md`，实施按 T1→T3）：source-thunk 模式（官方 `dsh-agent-default-model` 同款），投影/工具/命令/overview RPC 四处经 `readConfig` 每次使用读当前值——**thresholds×8 / checks×5 / cost 显示项 live 生效**；`projection.enabled` 经 onChange 重判定（dispose/重注册）live 切换；`validate` 三档阈值单调性写时拒绝；pricing 源 4 字段 restart（schema 文案注明）。**双源治愈**：live 路径默认值全走 schemastery schema，`resolveConfig` 降级为测试/回退路径。peer 新增 `@deepseek-ai/dsh-settings: ^0.1.0-rc.6`（局部升策略）
- **测试** — smoke +3（validate 单调 / readConfig 双形态 / thunk 换层即时生效）+ mount +1（**真实接线集成**：settings 写入 → 工具判定 live 变化 + validate 拒绝非单调——该测试抓到 `as` 强转压掉 thunk 未调用的真 bug，见 pits 2026-08-26）
- **测试规模** — smoke 107 + mount 6 + client-mount 7 + visual 6
- **S4 canary 发布通道（顺带交付）** — `publish.yml`：prerelease 版本（`0.10.1-next.0` 形态，tag 同后缀）自动 `npm publish --tag next`（不动 latest）；新增 `canary-promote.yml`（workflow_dispatch 输入版本号 → 守卫 prerelease/存在性 → `npm dist-tag add … latest`，走同一 npm-publish 审批门）；流程文档入 `PUBLISHING.md`

### 0.11.0 审计收敛与工程化

- **AUDIT-0.10.0 修复批** — P1×4 / P2×6 / P3×3 已修（`a73578e`）：OV-1 空结果双连采信清空（幽灵列表自愈）、OV-2/3 `isLoopback` fail-closed + Host 头校验（防 DNS rebinding）、C1-1 settings 接线 try/catch 降级、C1-2 syncProjectionUnit 去重 pending inject、C1-3 validateConfig 全数值字段有限性、R1-1 采样按 (turn, step) 去重（stateVersion 9→10）、R1-2 不再泄漏「null%」、R1-3 压缩捕获失败失效陈旧比例、R1-4/5 sparkline aria 口径 + overflow 可见；recorded 项留档（`docs/AUDIT-0.10.0.md`）
- **client.tsx 模块化拆分** — 1286 行单体 → `src/client/{styles,shared,badge,command-card,overview}` + 瘦身入口（`6584007`）：slot 注册与 CSS 注入零变化，`parseCompassReport` / `mergePressure` / `lagOf` 保留入口再导出供 client-mount 断言；门禁 7 步全绿、visual 基线不变
- **peer 基线升 `^0.1.1-rc.2` + 适配 0.1.1 投影契约**（`666ee8f`）— 修 prerelease 门控陷阱（旧 range 连当时部署的 0.1.1-rc.2 都声明不上）；wire 双契约对齐
- **OV-5 抽共享排序模块** — 收敛 host/client 双份实现（`7330d3d`）；OV-7 SWR 后台刷新独立 AbortController、OV-10 TTL 注释对齐、测试洞 3/4/5 补齐（重放等价性 / chunk 封顶 / compaction-chunk 交互）（`1e359ef`）
- **harness 0.1.2-alpha.1 影响评估 + C2 设计定稿** — 两项高影响记账（`sessionProjectionCache.coldSnapshot` 签名 breaking / `conversation.chat.commandview` slot 移除，详见本地私有未追踪的 HANDOFF §3.1）；C2 设计定稿入 `docs/C2-SETTINGS-CARD-DESIGN.md`

### 一览面板周期（0.7.14 → 0.7.17）

- **性能重构（0.7.16/0.7.17）** — 双缓存 + 活动列 + RPC 时延断言；listSessions 缓存 TTL 2.5s→6s（对齐 5s 轮询间隔）→ stale-while-revalidate（过期帧立即返回旧列表 + 后台刷新，任何帧不等慢查询）；contract-check 加冷启动预热重试豁免。实测轮询帧 **≤20ms**（冷启动首帧唯一例外）
- **排序规则重构（0.7.15）** — **运行中置顶** → 组内红→黄→蓝→绿 → 非运行中同梯 → 已加载>冷却 → 新在前（host+client 双侧同规则）
- **排版精修（0.7.15）** — 列宽按实测内容定宽、数字列表头右对齐、次要列降灰、修 8px 容器错位；视觉基线随更新（darwin + linux 双平台入库）

## 待做（按优先级）

> 主线目标：**发布稳定、不影响体验**。顺序原则：稳定性基建 > 零风险功能 > 需兼容测试的功能 > 需先调研设计的大项。

### 稳定性基建（保证发布稳定）

> **稳定性基建 S0–S4 全部交付**（S4 见「已交付」0.10.0 段），本节无待做项。

### 配置点接入（C1 已交付，C2 待实施）

> `ctx.settings` 插件配置点：Host 注册 settings 命名空间 + Client 在 `settings.plugin.item` 槽注册卡片，设置 UI 直接调参。**C1 已交付（0.10.0，设计定稿 `docs/C1-SETTINGS-DESIGN.md`）；C2 待实施。**

| # | 项 | 优先级 | 动机 / 价值 | 依赖 |
|---|---|---|---|---|
| C2 | **Client 配置卡片**（`settings.plugin.item` keyed 自建） | P3 | 设置 UI 直接调参 | C1 已落地；场外插件不可复用内置控件（bundle 门禁），需自建表单 + 草稿暂存 + revision 设栅（`SettingsConflictError` 兜底）；卡片数据面走既有 `/context-compass-rpc` 转发 `describe({redactSecrets:true})`/`update` |

### 功能项

> R1 已交付（0.9.0），见「已交付」。

| # | 项 | 优先级 | 动机 / 价值 | 依赖 |
|---|---|---|---|---|
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
| **0.8.0** | S2 stateVersion 兼容测试 + S3 配置生效冒烟（S4 canary 可选，顺延）——稳定性基建收尾 |
| ~~0.9.0~~ | R1 sparkline（已交付）· C1 调研 + 设计定稿（已交付）|
| **0.10.0** | **C1 host 配置点接入（已交付，随本版发）**——`installSettingsSection` getter 模式：thresholds/checks live 生效、resolveConfig 双源治愈、validate 三档单调、projection.enabled live 切换；pricing 源 4 字段 restart |
| **0.11.x** | C2 client 配置卡片（设计定稿已出 `docs/C2-SETTINGS-CARD-DESIGN.md`，实施待 dsh 0.1.2 发版后）· **harness 0.1.2 升级适配**（两项高影响：`sessionProjectionCache.coldSnapshot` 签名 breaking / `conversation.chat.commandview` slot 移除，详见本地私有 HANDOFF（不入仓库）§3.1） |
| **后续** | R3 / R4 / R5 / R6 · B1 / B2（等依赖就绪）|

## 维护规则

- 本文件是路线图的**唯一权威来源**；完成一项 → 从「待做」移到「已交付」并标注落地版本
- 被阻塞项保留在「被阻塞」并写明卡点；卡点解除后移回「待做」
- 优先级/排期变化只改这里；`HANDOFF.md`（本地私有未追踪）/ `DESIGN.md` / `OPTIMIZATION-RESEARCH.md` 引用本文件、不复制路线内容
- **peer 基线策略**：`peerDependencies` 声明"最低要求的服务版本"，保持宽松、不随 harness 每次升级而升。**2026-08-29 已升 `^0.1.1-rc.2`**（此前 `^0.1.0-rc.6` 有 semver prerelease 门控陷阱：`>=0.1.0-rc.6 <0.2.0` 的带 prerelease 比较符元组是 0.1.0，仅 rc.8 这类元组 0.1.0 的版本匹配；0.1.1 系列元组 0.1.1 **不匹配**——旧 range 连当前部署 0.1.1-rc.2 都声明不上）。`^0.1.1-rc.2` 覆盖 0.1.1-rc.2 + 未来 0.1.2 正式版（`<0.2.0`）；**0.1.2-alpha.1 尚未发布 npm（暂不可声明 `^0.1.2-*`），待发布且接入其独有 API 时再局部升**（参考：C1 接入 `@deepseek-ai/dsh-settings` 的局部升先例）
- **升级体检基线（S1 依据）**：每次 harness 升级，对照 live 契约校验插件硬注入（commands / tools / sessionProjections / webServer）+ 全部 `ctx.get` 可选读取 + client slot（sidebar.footer.action / shell.overlay / conversation.session.header.utilities；`conversation.chat.commandview` 已于 **0.1.2-alpha.1** 随会话流重构移除，/compass 卡片待换新机制）是否仍存在、形状是否兼容。rc.8 本次校验通过（见 commit `5a00d11`/`04a4600` 前后；原文 `9b98c07` 为早期改写前坐标）；**0.1.2-alpha.1 预判已记账（本地私有未追踪的 HANDOFF §3.1）：coldSnapshot 签名 breaking + commandview 移除，其余（事件词汇 / cachedSnapshot / settings Host mutate / 各 slot）验证无影响，待正式版实测**