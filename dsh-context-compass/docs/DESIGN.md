# dsh-context-compass 插件：设计文档（方案 + 设计笔记）

> 状态：**已发布并归档（2026-08-14，v0.4.8）**——npm latest + 本地 profile 从 npm 加载验证通过。
> ⚠️ **历史设计快照（v0.4.8 时代）**：现行版本 **0.11.0**（npm latest；命令注册名 `compass`、`projection.enabled` 默认 `true`、smoke 107 项），**以 `README.md` / `docs/ROADMAP.md` / `PUBLISHING.md` 为准**。下文原文保留以追溯设计脉络，未随后续版本改写。
> 来源方法论：社区 session-health 技能（本地 `~/.agents/skills/`，见其 `SKILL.md`）——二维决策模型、工作性质 5 问、交接就绪检查，完整移植；数据层改用 DSH 原生信号。

## 0. 实现状态（2026-08-14，**v0.4.8 已发布**）⚠️ *历史快照（v0.4.8 时代）；现行 0.11.0，以 README/ROADMAP 为准*

> 最终形态速览：投影驱动 badge（零轮询）、`/compass` 命令 + `context_compass` 工具、阈值/检查项/价格全部可配置、官方峰谷定价（CNY+USD 双币，按北京时间判定时段、按 locale 选币种）、交接清单自动化、进程检测。构建 = tsc + esbuild `__ModuleLoader__` 工厂 bundle；验证 = smoke 35 项 + mount + client-mount。

| 项 | 状态 |
|---|---|
| `/compass` 命令（Host，commands 注册） | ✅ 定稿（pkg-8 + 0.2.0 重构）：首行行动结论 + 加粗健康度（绿/蓝/黄/红四档），详情列表，切换前检查清单，无 emoji、无 HTML；参数 `minimal` / `no-git` / `no-handoff` / `doc=<文件名>` / `remaining=<轮数>` / `processes` |
| 数据源 | ✅ tokenMeter（精确）/ llm.resolveModelInfo（窗口）/ sessionQuery + sessionHealth 投影（计数）/ fs（探测）/ sandboxPolicy（工作区根）/ subprocess（ps 只读探测） |
| **`context_compass` 工具（phase 2）** | ✅ v0.2.0：`ctx.tools` 注册，只读、15s 超时；参数 `reason` / `remainingRounds` / `dependsOnEarly` / `earlyDecisionRecorded` / `handoffDoc`；结构化输出 `severity`(4 档) + `recommendation`(continue/continue-with-note/suggest-switch/danger-zone) + `signals` + `handoffReady` + 黄/红档完整报告；工作性质 5 问由模型自查（1a/1b/4）+ 主机探测（2/3） |
| **上下文罗盘投影（phase 2）** | ✅ v0.2.0：`sessionHealth` 单元注册于 `ctx.sessionProjections`（`ctx.inject` 可选子挂载，无注册表时降级）；纯事件折叠（step/end 轮次、消息数、compaction/end 压缩次数、usage 样本 last-wins 压力 + **lastUsage 桶**、request/context 窗口）；view 按配置阈值算 severity + advice + **cacheHitRate / effectivePerRound（cost.cacheHitDiscount 默认 0.1）**；客户端 `faceOf('sessionHealth')` 订阅——**badge 零轮询**，push 帧即更新；stateVersion 2 |
| **阈值可配置化** | ✅ v0.2.0：schemastery `Config`（thresholds: windowMid/High/Critical、economyTokenFloor/RoundFloor、messageCountProxy；checks: git/handoff/sessionResume/processes 开关 + handoff.paths；projection.enabled），`resolveConfig` 防御性默认 |
| **进程检测（phase 2）** | ✅ v0.2.0：`ctx.subprocess` 只读 `ps -axo` 探测，按工作区 basename + dev-server 标记过滤，最多 5 个；缺失 subprocess 优雅降级。**v0.4.0 交接清单自动化**：`git status --short` / `git log --oneline -1` / `git status -sb` 只读白名单探测（工作树干净数、最新 commit、ahead/behind），checklist 变为真实 [x]/[ ] |
| 判定 | ✅ 四档（绿/蓝/黄/红）：窗口占比 ≥0.8 红；≥0.5 或每轮计费当量 ≥ max(50K, 0.3×窗口) 黄；≥0.3 蓝；**消息数代理 ≥800 绿→蓝升级**；经济（缓存折扣计费当量）优先于容量；工具在「依赖早期内容且未记录」时升级 danger-zone（禁止裸切）。**v0.5.0 校准**：经济口径从原始压力 token 改为 effectivePerRound（消除 cacheWrite 双计 + 与金额显示一致），门槛随窗口缩放——修复 1M 窗口下 15% 占用即误报黄色 |
| **UI 色点（badge）** | ✅ v0.2.0 重构：**纯投影驱动**（`sessionHealth` 单元帧推送，零轮询零 RPC——客户端 Remote 是构建期固定清单，社区插件 Remote 无法挂载，故移除 Typert Remote 服务）；悬停提示扩充（建议、占用条、每轮输入 + **缓存命中率**、**预计下次输入（剔除缓存命中）**、**计费预期（金额，¥/$ 按 locale，忙/闲时标注）**、窗口、轮次/消息、压缩次数）；**点击经核心 `remote.commands` 运行 /compass**；**占用数合并 token-meter 压缩感知 `contextPressure.projectedTokens`**；蓝档色点；a11y；客户端 bundle 走 `__ModuleLoader__` 工厂格式（esbuild，build-client.mjs），样式走 `<style data-plugin>` 契约注入 |
| 验证 | ✅ `tsc` 构建 + esbuild 客户端 bundle + 严格 typecheck；`npm run smoke`（47 项：折叠/阈值/缓存命中/双币定价/忙闲时/费用/消息代理/评估/git 自动化/命令/工具/文案/压缩比例）；`npm run mount`（真实 cordis 挂载：命令 + 工具 + 投影单元 + git checklist 断言）；`client-mount`（浏览器挂载路径：__ModuleLoader__/inject/merge/lagOf/解析/样式/locale）；`npm run visual`（Playwright 视觉回归：明/暗 × 四档 × 卡片展开矩阵 + hover 桥接层 e2e） |
| **发布与归档** | ✅ v0.4.8 发布 npm latest；本地 profile 从 npm 加载（`^0.4.8`）运行验证通过；双语文档齐备；发布记录见 `dsh-context-compass/PUBLISHING.md` ⚠️ *历史快照：现行 npm latest 0.11.0，见 `PUBLISHING.md` 版本历史* |
| 输出约束 | ✅ 无 emoji（跨平台一致）；DSH 渲染器 raw HTML 字面输出 → 颜色只能 UI 给 |

## 1. 定位与方案（C）

**它是什么**：一个 DSH bundle 插件，让用户（和模型）随时评估当前会话的"继续 vs 新开"健康度，输出**真实数据支撑**的报告（不是体感）。

**为什么 DSH 做这个有独特优势**（vs 技能在 Cursor 上的信号缺失降级）：

| 信号 | session-health 技能在 Cursor | dsh-context-compass 在 DSH |
|---|---|---|
| 上下文占用（每轮 token） | ❌ 估算（消息数 × 单条均值） | ✅ **`ctx.tokenMeter` 精确测量** |
| 模型窗口 | 查表/问用户 | ✅ llm 适配器 `contextWindow`（deepseek 1M） |
| 压缩比例 | ❌ 跳过（"无压缩标记"） | ✅ token-meter 快照 vs 累计推断 |
| 消息数/轮次 | 目录扫描 | ✅ 会话事件流统计 |
| 恢复能力 | 工具历史面板 | ✅ JSONL + sessionQuery + 投影缓存 |
| 经济成本 | ❌ 无法量化 | ✅ tokenMeter 绝对值 × 剩余轮数 |

**消费面（三个）**：
1. `/compass` 命令——用户主动（`ctx.commands`）
2. `context_compass` 工具——模型在长任务中自查，必要时建议用户（`ctx.tools`）
3. 上下文罗盘投影（可选，phase 2）——`sessionProjections` 折叠常驻状态，侧边栏指示

**形态**：单 bundle 插件（`dsh.bundle` + `cordis.patch.yml`），零新引擎机制——纯组合现有服务（tokenMeter / sessions / sessionQuery / llm / commands / tools / approval / subprocess-git-readonly）。

## 2. 数据源映射（代码事实）

| 信号 | 数据源 | 获取方式 |
|---|---|---|
| 每轮输入 token | `ctx.tokenMeter` | 按 session 键控的 replay 测量（`estimateMessage` 导出可用）；报告口径"≤ 快照上界" |
| 窗口大小 | llm 适配器 | 当前模型路由的 `contextWindow`（`agentDefaultModel` → 适配器模型表） |
| 消息/轮次 | 会话事件 | `user/message`、`turn/start`、`assistant/message` 计数（经 `ctx.sessions` 或 sessionQuery 读取当前 session） |
| 压缩痕迹 | tokenMeter 快照序列 | 快照 token 下降或 compaction 事件出现 → 压缩已发生（比例按下降幅度估算，标注口径） |
| git 状态 | 只读 git 命令 | `git status --short`、`git log --oneline -1`（subprocess，工作区 cwd；只读子命令白名单） |
| 交接文档 | 文件系统 | 交接文档存在性检查（fs 只读；只探测用户配置的文件名。本仓库自身的 `HANDOFF.md` 已改为本地私有未追踪，读者在发布仓库中看不到） |
| 工作性质 | 模型判断 + 用户确认 | 工具内部先自查（对话内容可推断），关键项用 `ask_user_question` 确认 |

## 3. 判定模型（移植技能，参数化）

### 维度 A —— 继续成本（取最严信号）
| 信号 | 阈值（默认参数，可配置） | 成本 |
|---|---|---|
| 窗口占比 | ≥ 50% / 30-50% / < 30% | 高 / 中 / 低（容量） |
| 经济（计费当量） | ≥ max(50K, 30%×窗口) token/轮 **且** 剩余 ≥ 10 轮 | 高（每轮历史输入费） |
| 经济（计费当量） | ≥ max(50K, 30%×窗口)/轮 **或** 剩余 ≥ 10 轮 | 中 |
| 压缩比例 | ≥ 50% / 30-50% | 中 / 低-中（质量，非容量） |
| 消息数 | ≥ 800（代理指标） | 低-中 |

优先级：**经济 > 容量 > 压缩 > 消息数**（每轮都付）。**经济口径 = 缓存折扣后的计费当量（effectivePerRound）**，门槛随窗口缩放（`economyWindowRatio=0.3`）——50K 绝对默认按 ~128K 窗口校准，1M 窗口模型上裸用会在个位数占比误报黄色（0.5.0 修复：15% 占用 + 高命中不再黄；仅无缓存会话真实计费当量 ≥30%×窗口 才由经济维度触发黄）。

### 维度 B —— 切换成本（工作性质 5 问）
1a 依赖早期内容？（重构/优化 = 是）· 1b 早期决策已记录？（文档/git/命名）· 2 已 commit？· 3 交接文档有？· 4 预计剩余轮数？
- 未 commit + 依赖早期 → **极高（禁止切换）**
- 独立任务 + 已 commit → 低

### 结论矩阵
| A \ B | B 低 | B 高 |
|---|---|---|
| A 低 | 🟢 继续 | 🟢 继续（git 追溯） |
| A 中 | 🟢 继续 | 🔵 留意；切换前补交接 |
| A 高 | 🟡 建议切换 | 🔴 危险区：深度交接后再切 |

## 4. 接口设计

### 4.1 命令 `/compass`
```ts
// ctx.commands 注册（dsh-commands 服务）
commands.register('compass', async (ctx, args) => {   // 0.6.1 起命令名由 'health' 统一为 'compass'
  const report = await assess(ctx)   // 见 4.4 数据流
  return report                     // 渲染为 markdown 消息
})
```

### 4.2 工具 `context_compass`
```ts
// ctx.tools 注册；只读工具（无 ask 门控）
context_compass(input: {
  reason?: string        // 触发原因（可选，用于上下文）
  remainingRounds?: number  // 模型对剩余轮数的预估（可省，5 问之一）
}): {
  summary: string        // 一句话结论
  report?: string        // 达到阈值时的完整报告（markdown）
  severity: 'green' | 'blue' | 'yellow' | 'red'
  signals: { windowPercent: number; tokensPerRound: number; compactionRatio?: number; messageCount: number }
  recommendation: 'continue' | 'suggest-switch' | 'danger-zone'
  handoffReady?: { clean: boolean; unpushed: number; hasHandoff: boolean; runningProcesses?: string[] }
}
```

### 4.3 配置 schema
```ts
z.object({
  thresholds: z.object({           // 维度 A 默认参数
    windowHigh: z.number().default(0.5),
    windowMid: z.number().default(0.3),
    windowCritical: z.number().default(0.8),
    economyTokenFloor: z.number().default(50000),
    economyWindowRatio: z.number().default(0.3),   // 经济门槛随窗口缩放（0.5.0 起）
    economyRoundFloor: z.number().default(10),
    compactionRatio: z.number().default(0.5),
    messageCountProxy: z.number().default(800),
  }).default({}),
  git: z.object({ enabled: z.boolean().default(true), allowedCommands: z.array(z.string()).default(['status', 'log', 'diff --stat']) }),
  projection: z.object({ enabled: z.boolean().default(true) }),   // phase 2；⚠️ 现行 schema/README 默认 true（旧稿误记 false，以现行 README 为准）
})
```

### 4.4 数据流（/compass 与工具共用 assess()）
```
assess(ctx):
 1. 事件统计：消息数/轮次（ctx.sessions 当前 session 事件计数）
 2. tokenMeter：当前 session 的每轮输入快照（≤上界口径）÷ contextWindow → 窗口占比
 3. tokenMeter 历史快照 → 压缩比例（下降幅度推断，标注口径）
 4. git 只读：status/log（subprocess，白名单命令）
 5. 交接文档存在性（fs 只读）
 6. 工作性质：模型自查（1a/1b/4）+ ask_user_question 确认关键项（2/3 已由 4/5 覆盖）
 7. 二维判定 → 报告（指标表 + 5 问 + 结论 + 交接就绪检查 + 新会话入口）
```

### 4.5 边界与安全
- **只读**：不修改任何会话文件/投影状态；git 只执行白名单只读子命令；输出无副作用
- 无 UI 依赖：headless 可用（命令 + 工具）
- 不自动建议：只评估；切换决策归用户（报告含时点判断：任务边界 vs 任务中间）
- 数据私密：报告仅当前会话可见（不写入会话日志之外的持久层——或 phase 2 由投影显式选择）

### 4.6 可配置/可选检查项（用户选取采用）

> 来源方法论假设了 git + 交接文档（`HANDOFF.md` 一类的文件；本仓库自身的 `HANDOFF.md` 已改为本地私有未追踪，发布仓库中不含）工作流——**并非所有用户都有**。检查项全部可配置，且按"探测 → 降级"运行：没有就不报错，标注跳过。

**配置 schema（检查项开关）**：
```ts
checks: z.object({
  git: z.object({
    enabled: z.boolean().default(true),      // 关闭后完全跳过 git 维度
    workspaceRoot: z.string().optional(),    // 默认 sandboxPolicy.workspaceRoot / session cwd
  }).default({}),
  handoff: z.object({
    enabled: z.boolean().default(true),
    // 用户的交接文档名/位置，完全用户自定义——不预设任何默认文件名。
    // 未配置时不做特定名字的探测，只提示"可在配置或 /compass doc=<文件名> 指定"。
    paths: z.array(z.string()).default([]),
  }).default({}),
  sessionResume: z.object({                  // DSH 原生恢复能力（替代/补充 git）
    enabled: z.boolean().default(true),      // 会话持久化 + checkpoint 存在性
  }).default({}),
  processes: z.object({ enabled: z.boolean().default(false) }), // 运行中进程检测（dev server 等，phase 2）
}).default({})
```

**探测降级规则**：
| 检查项 | 探测 | 未命中时 |
|---|---|---|
| git | `.git` 存在（fs.stat）或 `git rev-parse` 成功 | 标注"非 git 工作区，跳过"（不判 red） |
| handoff | 仅探测**用户配置的** paths（或 `/compass doc=<文件名>` 临时指定）；无配置则不做名字猜测 | 未配置 → 提示"未配置交接文档检查；如使用交接文档，可在配置或命令参数中指定"；配置了但没找到 → 标注"未找到你指定的交接文档" |
| sessionResume（DSH 特有） | 会话 JSONL 持久化 + 最近 checkpoint/投影缓存 | 标注"无持久化记录"（一般不会，DSH 始终持久化） |
| processes | 进程检测（phase 2） | 关闭时跳过 |

> 原则：**交接文档是"概念"不是"文件名"**——每个用户有自己的命名习惯（README、PROJECT、团队 wiki、.agents/notes 等），插件只认用户给的名字，输出文案也只用"交接文档"这个通称，不出现任何具体文件名。

**运行时选择**：
- `/compass`（默认：全部启用的检查项）
- `/compass minimal`——只报核心指标（token/窗口/消息），跳过 git/handoff
- `/compass no-git` / `/compass no-handoff`——临时排除指定检查项
- 持久偏好走插件配置（`checks.*`），临时排除走命令参数

**DSH 特有的恢复能力维度**：git 的"可恢复性"角色在 DSH 由**会话持久化**承担（JSONL 落盘 + 投影缓存 + 会话列表）——对不用 git 的用户，sessionResume 检查是更贴切的替代；git 检查保持为可选项而非默认假设。

## 5. 测试计划

| 领域 | 测试 |
|---|---|
| 信号采集 | tokenMeter 快照读取；事件计数；git 白名单拒绝非白名单命令 |
| 判定逻辑 | 阈值边界（49%/51%、49K/51K）；矩阵 2×2 全组合；优先级（经济>容量） |
| 工具 | schema 校验；severity 输出正确；abort |
| 命令 | /compass 渲染；无会话时降级 |
| 集成 | 真实会话上 /compass 输出与人工核对（消息数、窗口占比） |
| 投影（phase 2） | 折叠收敛；重启恢复 |

## 6. 发布与公开

- 独立 repo + `dsh-plugin` topic；README 含方法论来源（session-health 技能）+ 数据口径说明
- 文档公开：DESIGN（本文）+ 与技能版的信号对比表（DSH 精确 vs Cursor 降级）

## 7. 与记忆插件的协同

两个插件共用哲学（能力归插件、零引擎改动）与发布通道；记忆插件提供"跨会话知识"，上下文罗盘提供"当前会话状态"——互补不重叠。若官方将来做核心集成，两份设计都提供验证过的蓝本。

## 8. 后续计划

路线图已抽离为**唯一权威来源**：[`ROADMAP.md`](./ROADMAP.md)——含已交付（第一/二/三波）、待做（按优先级）、被阻塞项与排期。本文不再复制路线内容；后续只改 ROADMAP.md。

调研依据见 [`OPTIMIZATION-RESEARCH.md`](./OPTIMIZATION-RESEARCH.md)（优化机会矩阵）与 [`RESEARCH-COMPETITORS.md`](./RESEARCH-COMPETITORS.md)（九家竞品，37 处来源）。
