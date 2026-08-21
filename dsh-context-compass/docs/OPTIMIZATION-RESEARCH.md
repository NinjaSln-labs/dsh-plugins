# dsh-context-compass 后续优化调研分析

> 日期：2026-08-14（0.5.8 发布后）
> 范围：数据口径 / 判定模型 / UI/UX / 架构工程 / 发布运维 / 生态联动
> 竞品参照见同目录 [`RESEARCH-COMPETITORS.md`](./RESEARCH-COMPETITORS.md)（子代理调研产出）。
> 环境基线（用户确认）：**harness 无源码，是部署成品**——一切以全局安装的 `dsh`（`~/.nvm/.../bin/dsh`）与运行中的 Slot 树/已装包为事实来源；本文件不再依赖任何 harness 源码路径。

## 1. 现状盘点（0.5.8）

| 能力 | 状态 |
|---|---|
| 四档判定（绿/蓝/黄/红），阈值全可配 | ✅ |
| 经济维度：缓存折扣计费当量 + 窗口缩放门槛（economyWindowRatio） | ✅ 0.5.0 |
| 定价：官方峰谷双币（CNY/USD 按 locale）+ jsdelivr 主源 + GitHub raw 回退 | ✅ 0.5.1 |
| 配色：主题自适应四档（accent/ink/tint 三角色，明暗 ≥3:1） | ✅ 0.5.2 |
| 浮层：无颜色词标签（aria 保留）、可达性（桥接/延迟/焦点打开/入场动画） | ✅ 0.5.3/0.5.5 |
| 计费预期：金额 ↔ 计费当量 token 点击切换（localStorage） | ✅ 0.5.4 |
| 缓存命中：单数据源（核心 tokenUsage 投影）+ 单算法位置（src/usage.ts） | ✅ 0.5.8 |
| 压缩比例量化 | ❌ 仅计数压缩次数，比例维度未实现 |
| 会话列表健康点（多会话场景） | ❌ 提案已写（SESSION-LIST-DOT.md），缺 harness slot 声明 |
| 交接清单自动化（git 只读探测 + 进程探测） | ✅ |
| e2e/视觉回归测试 | ❌ 仅单测/挂载测试 |

## 2. 优化机会清单

### A. 数据与判定模型

#### A1. 压缩比例量化（P1，纯插件侧可落地）
- **现状**：`compaction/end` 只累加计数（浮层显示「已压缩 N 次」）；skill 方法论里的「压缩比例 ≥50% = 中档成本」维度缺失。
- **方案**：fold 内记录压缩前后的压力快照差值——压缩比例 ≈ `1 - 压缩后首个 usage 的 pressureTokens / 压缩前最后一个 usage 的 pressureTokens`（标口径：估算）。**不依赖 harness 事件载荷**（已确认无源码可查 compaction/end 载荷；运行时的 chat 节点类型存在 `compaction` / `manual-compaction`，说明压缩确有独立事件，但载荷未知，快照差值法最稳）。
- **价值**：补齐方法论第二维度；压缩比例高 + 依赖早期内容 = 切换成本判断的关键输入。

#### A2. 判定口径与占用条不一致（压缩后判定滞后，P1）
- **现状**：severity/ratio 由 host 投影用 last-wins `pressureTokens` 计算；浮层占用条用 token-meter 的压缩感知 `contextPressure.projectedTokens`。压缩后：条立即掉下来，但判定色要等**下一轮请求**的 usage 才更新——短暂「占用 10% 却还是黄/红」。
- **方案选项**：
  a) 接受滞后并在文案标注「压缩后下次请求更新」——零成本；
  b) 客户端在 projected 与 pressure 差异显著时给判定加「更新中」标记（灰闪）；
  c) 长期：把判定需要的 numerator 改为读 contextPressure 快照（需投影单元视图能拿到 session 上下文，架构改动大，不推荐现阶段做）。
- **推荐**：a + b 轻量组合。

#### A3. `economyRoundFloor` 未接入判定（P2）
- **现状**：`remainingRounds` 只在 /compass 文案里出现；severity 完全不用（徽章无轮数信息可理解，但工具/命令有）。
- **方案**：assess() 收到 `remainingRounds ≥ economyRoundFloor` 且经济维度命中时，severity 升一档（工具/命令路径）；徽章维持现状（无信息）。对齐 skill 的「≥50K **且** 剩余 ≥10 轮 = 高」。

#### A4. `messageCountProxy = 800` 未随窗口缩放（P2）
- **现状**：1M 窗口下 800 条消息的语义与 128K 窗口完全不同。
- **方案**：与 economy 同款处理——`effectiveProxy = max(messageCountProxy, messageCountWindowRatio × 窗口/每条约均)`；或退一步：按模型窗口分类给默认值（≤256K→800，1M→2000）。

#### A5. 轮次语义细化（P3）
- **现状**：`step/end` 按 distinct turn 计数——一个多工具调用的回合算 1 轮，与「消息数」代理重叠。
- **方案**：增加 step 计数展示（轮次 X / 步数 Y），判定仍以消息数为准。

### B. UI/UX

#### B1. 会话列表健康点 → 改道：多上下文罗盘一览面板（P0）
- **原提案（SESSION-LIST-DOT.md）被核心挡死**：实测运行中 Slot 树**没有 `session.row.trailing`**，`sidebar.workspaces` 是整体单座（replaceRisk: shadows-shipped-ui）且无每行渲染位——需要 harness 核心声明新 slot，**无源码做不了**。
- **改道方案（纯插件可实现）**：用现成 Slot——
  - `sidebar.footer.action`（list，root scope，replaceRisk: none）：侧栏底部加「罗盘一览」按钮；
  - `shell.overlay`（list，root scope）：全屏浮层面板，逐行列出所有会话（占用%、severity、计费预期），数据来自 `session.list` 行携带的 `projectionValues.sessionHealth`（SESSION-LIST-DOT 文档确认数据层就绪，冷会话走投影缓存）。
  - 行为：红色预警置顶、点击行跳转会话并运行 `/compass`。
- **价值**：多会话/multitask 场景的真实需求（用户已实测遇到）；比每行色点信息更全。

#### B1b. `/compass` 富卡片（P1，低成本的意外收获）
- 实测 Slot 树：`conversation.chat.commandview`（按命令名 keyed 的卡片位，**当前零占用**）——插件可注册 `health` key，让 `/compass` 输出渲染为带色块 severity chip + 交接清单的富卡片，而非纯文本。

#### B2. 浮层信息分层（P2）
- **现状**：一次展示 8 行（占用/每轮输入/预计下次/计费/窗口/规模/压缩/提示），信息密度高。
- **方案**：折叠次要行（会话规模/模型窗口）为「更多」；或按 severity 动态只显示相关行（红/黄档显示交接检查提示）。

#### B3. 一键交接/新会话入口（P2）
- **现状**：黄/红档 `/compass` 会给交接清单，但用户要自己执行 git 操作。
- **方案**：徽章浮层加「复制交接摘要」动作（生成含 git 状态/未提交变更/交接文档清单的文本，一键复制）——低成本、高实用。

#### B4. 多会话对比视图（P3，依赖 B1 数据层）
- 一个「所有上下文罗盘一览」面板（占用排序、红色预警置顶），multitask 场景升级项——B1 面板落地后天然具备，无需单列。

### B5. 竞品校准要点（来自 RESEARCH-COMPETITORS.md，子代理调研）

调研覆盖 9 家（Cursor/Claude Code/Copilot/Codex/Windsurf/Cline/Roo/ChatGPT/JetBrains），37 处来源 URL。对本插件最直接的五条：

1. **常驻占用 % 是硬需求**：Cursor 把 context % 改 hover-only 后论坛反弹；Codex Desktop 移除常驻指示被 issue 追着恢复（#23591/#23794）；Claude Code 至今无原生常驻 %（社区 #39415 求加）。→ 验证本插件「常驻投影驱动 badge」方向，且 badge 文本上的占用 % 应保持常驻（勿学 Cursor 撤掉）。
2. **阈值硬数据高度趋同，可作校准依据**：
   | 来源 | 阈值 |
   |---|---|
   | Copilot CLI | 80% 自动压缩 / 95% 强制暂停 |
   | Codex | 90% 硬上限（可下调）；建议 60% 主动 compact |
   | Cline 源码 | COMPACTION_TRIGGER=0.9，目标 0.7，保留最近 20K |
   | philschmid/Claude 权威参考 | 1M 窗口 ~25% 起 context rot，别等 100% |
   → 本插件 red=0.8 与 Copilot CLI/Cline 触发点同档；**windowMid=0.3 恰好对齐 rot 起点（~25%）**——判定模型的默认值有行业依据，可在文档中补注校准来源。
3. **压缩计数/比例是行业空白**：Claude 官方承认看不到压缩次数；Codex v0.112「死亡螺旋」证明看不见压缩会烧爆用量。→ 本插件「已压缩 N 次」+ A1 计划补的「压缩比例」= 护城河项（P1 保持）。
4. **成本/cache 有官方背书但无人产品化**（Claude 官方博客：cache 读 0.1x/写 2x/换模型打爆 cache）。→ 本插件「缓存命中 + 计费预期」领先，保持并可在浮层补一行 cache 生效提示（压缩趁 cache 还在时做）。
5. **「建议新会话」业界只有概念**：ChatGPT 达上限后被动弹「请新开对话」；Claude 官方只有文字决策表。→ 本插件二维判定矩阵是唯一系统化实现——差异化叙述的核心素材（README/发布说明可用）。
6. **无障碍基线**（GitHub Primer/Cimpress）：进度条必须「颜色 + 文字」双编码、相邻色段 ≥3:1——本插件无颜色词 label + aria + 明暗 ≥3:1 已达标，属合规不落后。

### C. 架构与工程

#### C1. 核心单点化推进（❌ 关闭——无源码）
- **结论**：token-meter 的 tokenUsage 投影加 `cacheHitRate` 字段需要改 harness 核心，**无源码不可做**。0.5.8 的插件侧单点（src/usage.ts）+ 与核心 StatsLine 的注释互相指认即最终状态；公式 1 行且操作同一份 totals，漂移风险已降至最低。

#### C1b. 环境基线固化（P1，运维）
- **现状**：harness 无源码、dsh 全局安装（`~/.nvm/versions/node/v24.18.0/bin/dsh`）、重启需 `dsh web`；DESIGN.md 等文档里的旧源码路径引用全部失效。
- **方案**：文档改为「以 `which dsh` / `npm root -g` 为准」；发布与重启流程固化为全局 dsh；调研文档作为新基线。

#### C2. 测试补强（P1）
- **现状**：smoke（单测级）+ mount + client-mount；无浏览器级测试。
- **方案**：Playwright 视觉回归矩阵（明/暗主题 × 四档 × 浮层展开），锁定配色对比度与布局；hover 路径 e2e（桥接层可达性回归）。可复用 harness 既有 e2e 基建（apps/web/tests）。

#### C3. 发布流程自动化（✅ 已落地 2026-08-15——四次 token 教训）
- **方案**：
  a) GitHub Actions：push tag `v*` 时自动 `pnpm publish`（token 存 repo secrets，不进任何对话）；——**已实现**：`.github/workflows/publish.yml`，tag 触发 + 验证链 + 版本一致性守卫 + environment 人工审批门；granular token 仅授权 `dsh-context-compass` 包
  b) 版本纪律：`npm version patch/minor` 生成 tag + changelog，未发布的版本号不留痕（0.5.6/0.5.7 教训：不要提前 bump 到未发布版本后又在下一版里写「被取代」）；
  c) 本机发布改走 `npm login`（凭据只在 ~/.npmrc），代理不再接收对话 token。

#### C4. 定价文档同步自动化（P2）
- `pricing/deepseek.json` 手动同步官方页；可加一个 CI 定时 job 对比官方文档 URL，变更时开 PR。

### D. 生态联动

#### D1. 与 session-health 技能回写（P2）
- 插件阈值（windowMid/High/Critical、economyTokenFloor、messageCountProxy）与技能默认参数同源但已分叉；考虑技能侧改为引用插件配置说明，或插件生成一份「校准后默认值」回写技能文档。

#### D2. 知识库联动（P3，**解耦版——不绑定 dsh-knowledge-sqlite**）
- **约束**：不能硬依赖 dsh-knowledge-sqlite（其他用户不一定装）。且其写入面只有内部 `_seedWrite`（trusted writer，stamp 由内部派生）与带 ask 门控的 `knowledge_write` 工具——插件无正当身份自动写，越权不可取。
- **方案（零依赖、零越权）**：
  1. `/compass` 报告尾部附**结构化交接快照段**（固定键名：severity/recommendation/交接就绪/未提交变更/压缩比例/时间戳）——纯文本可 grep，任何记忆/知识插件与用户都能摄取，不特指 dsh-knowledge-sqlite
  2. **可选探测 `ctx.get('knowledge')`**：存在则在新会话用其 `search()`（只读、scope 隔离安全）检索「上个会话交接快照」并在 `/compass` 输出「跨会话回顾」；不存在则 probe 一行「知识库未安装，跳过」
  3. **写回不自动做**：留给用户/模型显式 `knowledge_write`（自带 ask 门控）
- 若未来想要「探测到即自动写回」的强联动，需 dsh-knowledge-sqlite 侧开放**公开、带门控的写入服务**（跨仓库协作项）。

## 3. 优先级与路线图

优先级矩阵与路线图已抽离为**唯一权威来源**：[`ROADMAP.md`](./ROADMAP.md)——含已交付、待做（按优先级）、被阻塞项与排期。本文不再复制路线内容；后续只改 ROADMAP.md。

## 4. 风险与开放问题

- 多会话一览的数据获取方式（session.list 行投影值）需按实际 apiproxy 契约在浏览器里验证一次（文档称已就绪）。
- 压缩事件载荷未知：A1 用快照差值推断，需在真实会话上验证一次口径。
- A2 的「判定滞后」是否值得动客户端，取决于用户体感——先出标注文案版本试用。
- 全局 dsh 升级可能改变 Slot 树/投影字段：插件发布前跑一遍 mount + client-mount + 手动冒烟即可覆盖。
