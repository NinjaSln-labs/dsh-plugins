# 审计报告：dsh-context-compass 0.7.11（第二波四项）

> ⚠️ **坐标时效说明**（2026-08-30 补记）：本记录写于多次仓库历史改写（行尾 renormalize、Contributors 污染清理、2026-08-29 交接文件清除）之前，文中 commit 短坐标多为**改写前旧坐标，已不可解析**。内容仅作历史审计过程存档，追踪对应改动请以标题/日期在当前 `git log` 中检索。

- 日期：2026-08-19
- 固定点：`context-compass-v0.7.10`
- 范围：3 commits（`1e83d33` 视觉基线刷新 / `d4b0db1` 视觉只读化 / `b199ecb` 第二波四项 B3/A3/A4/B2）
- 方法：双轴并行子代理（Standards：仓库约定 + Fowler smell 基线；Spec：`OPTIMIZATION-RESEARCH.md` A3/A4/B2/B3 + `DESIGN.md`）

## 状态图例
`open` 待修 · `fixed` 已修（含证据）· `recorded` 裁决不修（含理由）

## Standards 轴发现

| # | 发现 | 状态 | 证据 / 裁决 |
|---|---|---|---|
| S1 | summary RPC 用 `resolveConfig({})` 忽略插件挂载配置（用户阈值/检查项失效；handoff.paths 为空 → 摘要恒「交接文档：未找到」） | **fixed** | overview.ts 现在接收 `config: ResolvedConfig` 第 4 参，index.ts 传 `resolved`；summary 分支用 `config` |
| S2 | `session as never` 突破类型边界（assess 的 session 访问失去编译保护） | **fixed** | 改为 `as Session`（import `@deepseek-ai/dsh-session`） |
| S3 | fetch 无 signal 关联，组件卸载后仍可能 setCopied | **fixed** | `mountedRef` 守卫 + cleanup |
| S4 | RPC summary 无鉴权，同源可枚举 sessionId 拉 git 状态 | **recorded** | 已 loopback-only（127.0.0.1 白名单）→ 仅本机进程可访问；DSH web 是唯一同源，恶意网页无法跨域；DSH 生态内插件共享 webServer 是设计使然。不额外加鉴权 |
| S5 | A3 的 economyFloor/economyHit 与 projection.ts 重复计算（公式分叉风险） | **fixed** | 用 `yellow && !capacityHigh` 等价替代（healthView 的 yellow 仅来自 capacityHigh 或 economy，`!capacityHigh` ⟹ 经济命中）——单点权威在 projection |
| S6 | `opts.remainingRounds!` 非空断言冗余 | **recorded** | TS 无法从独立布尔变量收窄，`!` 必要 |
| S7 | 移除 card.spec → 卡片渲染无浏览器级视觉覆盖 | **recorded** | 只读化权衡：视觉套件不再写会话；卡片功能由 smoke（parseCompassReport/buildCommandText）+ client-mount 覆盖；新增 skip 的浮层 B2/B3 交互测试待 0.7.11 部署启用 |
| S8 | buildHandoffSummary 与 buildSnapshotText 结构相似（Duplicated Code 苗头） | **recorded** | 语义不同（人读摘要 vs 机器摄取快照）、用途不同、格式不同——合并反而耦合，保持独立 |
| S9 | HealthBadge 组件膨胀（Divergent Change：costAsTokens/lag/showMore/copied 四组状态） | **recorded** | 浮层已达可拆分规模，但当前 cohesive（都服务浮层展示）；拆子组件属后续重构项，不影响正确性 |

## Spec 轴发现

| # | 发现 | 状态 | 证据 / 裁决 |
|---|---|---|---|
| P1 | B3 摘要缺 branchLine（push 状态）——规格要求「git 状态」，未提交+commit 有、push 缺 | **fixed** | buildHandoffSummary 加 `分支：{branchLine}` 行 + smoke 断言 |
| P2 | B2 多折叠「已压缩」行——压缩比例是 A1 核心信号 + 滞后提示前提，折叠与 A1 主张冲突 | **fixed** | 「已压缩」移出 showMore，保留默认视图；showMore 只折叠窗口/规模（与规格原文一致） |
| P3 | A3 的 economyHit 冗余（yellow 时经济必命中） | **fixed** | 同 S5，删除冗余判定 |
| P4 | B3 summary RPC 忽略已注入的 resolved 配置 | **fixed** | 同 S1 |
| P5 | B2/B3 新 UI 无浏览器级测试覆盖 | **fixed（部分）** | 新增 skip 的浮层交互测试（badge.spec），0.7.11 部署后启用 |
| P6 | B2 方案二（红/黄档动态显示交接提示）未做 | **recorded** | 规格为「或」——方案一（折叠）已满足；滞后提示（sh-tip-lag）本就在默认区，红/黄档可见性已覆盖 |

## 修复后全链验证
- `npm run build` + `npm run smoke`（54 项）+ client-mount + mount + typecheck：**全绿**
- visual 套件：5 项通过 + 1 skip（浮层 B2/B3，待部署）

## 结论
双轴共 15 项发现：**fixed 7**（S1/S2/S3/S5/P1/P2/P3，其中 S1/P4 同源）、**recorded 8**（均附理由）。无残留 open 项。核心 bug（summary 忽略用户配置）被双轴独立捕获并修复。

---

# 追加审计：2026-08-19 第三轮（严格审查至零残留）

- 固定点：`91e02fb`（上轮审计修复后）
- 方法：双轴并行子代理（Standards/Spec）+ 主审查逐文件通读 + 全链验证 + 第三方独立复核
- 提交：`1da78f5`（修复 4 项）、`9b7c1a4`（修复 1 项）、`60ee06c`（收尾 2 项），均在 main

## 发现与处置

| # | 发现 | 状态 | 证据 / 裁决 |
|---|---|---|---|
| T1 | **tool.handoffReady 缺 branchLine**（push 状态）——B3 审计修复只补到 buildHandoffSummary，模型侧看不到未 push 提交；Standards 硬违规 + Spec 补充发现（DESIGN §4.2 工具 schema 原文 `unpushed` 未落实） | **fixed** | tool.ts schema + execute 补 branchLine；smoke 断言（gitCtx 下 handoffReady.branchLine = `## main...origin/main [ahead 2]`） |
| T2 | **processes.enabled 默认 true 与 DESIGN §4.6「default(false) / 关闭时跳过」矛盾**；且 `config.enabled && checkProcesses` 的 AND 逻辑使显式 `/compass processes` 在配置关闭时失效（README「强制进程探测」语义落空） | **fixed** | config.ts 默认 false + resolveConfig 同步；assess.ts 改 `(enabled \|\| checkProcesses)`——显式参数强制开启；README 双语同步；smoke +2（默认跳过 / 显式探测 / 配置开启） |
| T3 | **overview.scheduleTitleFill 注释声称「fresh signal，请求 abort 不杀填充」与实现相反**（实现绑定请求 signal） | **fixed** | 注释纠错为「绑定请求 abort 作用域——面板关闭后填充无消费者，取消避免无谓日志读」；文件头注释同步 |
| T4 | **parseCompassReport 把尾部交接快照段混入 reason**——buildCommandText 始终追加 `---` + 快照段，所有档位卡片 reason 被机器文本污染 | **fixed** | `---` 起始 break 停止解析（分隔行提取为共享常量 SNAPSHOT_SEPARATOR，T5 关联）；client-mount +2 断言 |
| T5 | PUBLISHING.md 0.7.11 B2 描述把「已压缩」列为折叠行，与 P2 修复（保留默认视图）矛盾 | **fixed** | 文档纠错 |
| T6 | assess fallback（无投影注册表）时经济维度全失效（effectivePerRound null） | **recorded** | headless 装配设计使然：经济依赖投影 usage 桶；与投影路径行为一致，不修 |
| T7 | copySummary 客户端无 fetch 超时 | **recorded** | 服务端 10s abort 兜底（overview.ts:413），客户端 fetch reject 走 finish(false)；mountedRef 防泄漏。UX 反馈弱（失败无提示）属改进项非 bug |
| T8 | refreshAny 串行尝试 URL（最坏 20s） | **recorded** | 有序回退是特性（主 URL 优先）；刷新周期 24h，非关键路径 |
| T9 | cacheWriteTokens=0 重建 | **recorded** | 口径内正确（effectivePerRound 不计 cacheWrite；cacheHitRate 走核心 tokenUsage）——Standards 子代理确认 |
| T10 | PriceCache.get 每次 Date.now() | **recorded** | 高频但廉价（period 评估），投影 push 帧调用可接受 |
| T11 | processes 默认关闭时无「已跳过」标注（用户无法区分「未检查」与「无进程」）——第三方复核 P3 | **fixed** | assess 补 probe 行「进程检测：已跳过（默认关闭；/compass processes 或配置启用）」；smoke 断言更新（60ee06c） |
| T12 | 快照分隔行 `---` 在 knowledge.ts 与 client.tsx 两处硬编码——复核 P3 防漂移 | **fixed** | 提取共享常量 SNAPSHOT_SEPARATOR（knowledge.ts 导出，client.tsx import）；buildSnapshotText / 回顾过滤 / parseCompassReport 三处共用（60ee06c） |

## 第三方独立复核（子代理，对 1da78f5 + 9b7c1a4 全 diff）
- processes 语义改动：**确认正确**（三入口自洽，无回归）
- branchLine 补丁：**确认正确**（schema/execute 一致，null 守卫无 undefined 泄漏）
- parseCompassReport break：**确认正确**（快照段前无裸 `---` 行，checklist 顺序不受影响）
- 测试有效性：**确认有效**（无恒真断言）
- 结论：**可发布**；两项 P3 建议已在本轮（T11/T12）修复

## 修复后全链验证
- `npm run build` + `npm run smoke`（**61 项**）+ mount + client-mount + typecheck（strict）：**全绿**
- visual 套件：**5 项通过 + 1 skip**（浮层 B2/B3，待 0.7.11 部署后启用）

## 结论
第三轮共 **7 项 fixed**（T1-T5、T11、T12）、**5 项 recorded**（T6-T10，均附理由）。**无残留 open 项**；第三方复核确认可发布，其 P3 建议已收敛。**发布前待办**：tag `context-compass-v0.7.11` 仍在 `b199ecb`，需前推到 HEAD 或 bump 版本后再走 CI 发布（用户决定时机）。

---

# 追加审计：2026-08-19 第四轮（换角度深挖——安全/竞态/边界/一致性）

- 固定点：`60ee06c`（第三轮收尾后）
- 方法：六个新角度（安全[body限制/路径穿越/注入]、类型断言审计、竞态与生命周期、未测试路径、文档-实现一致性、CSS/格式化边界）+ 第四轮独立复核子代理
- 提交：`3173f5c`（安全+一致性）、`a34ae1f`（文档+格式化）、`3d0f2c2`（NaN 防御）、`6d5055f`（remaining NaN 归一化）、`4d5ce5f`（断言细化），均在 main

## 发现与处置

| # | 发现 | 状态 | 证据 / 裁决 |
|---|---|---|---|
| R1 | **readBody 无大小限制**——异常大 POST 可 OOM 进程（loopback-only 缓解外部面，同源进程仍可触发） | **fixed** | 16KB 上限 + 413（3173f5c）；smoke 断言 20KB body → 413 |
| R2 | **handoff 探测路径无白名单**——docName/handoffDoc 可被提示注入引导到 cwd 之外（绝对路径 / `..` 逃逸）；虽只回报布尔存在性，防御缺失 | **fixed** | safeRelativeName 白名单（拒绝对路径/UNC/盘符/`..` 段，允许相对子目录）；smoke 三态断言（3173f5c） |
| R3 | **git/handoff 配置关闭时无跳过标注**——与 processes 的 T11 修复不对称 | **fixed** | 补「已跳过（配置关闭）」标注；smoke 断言（3173f5c） |
| R4 | **formatCompact 舍入溢出**——999500/999999 显示 `1000K`（K 段 round 越界），与 M 段格式不一致 | **fixed** | round-overflow guard（k≥1000 进位 M 段）；util.ts + client.tsx 双实现同步；smoke 边界断言（a34ae1f） |
| R5 | **投影 fold NaN 污染**——流式 `assistant/chunk`/`assistant/message` 的 usage 缺 inputTokens 时 pressureOf 产出 NaN，污染投影状态并覆盖有效压力（zod v4 虽拒 NaN 但 NaN 已是 number 类型） | **fixed** | usage.inputTokens 缺失时跳过压力/桶更新（不覆盖已有压力）；pressureOf/bucketsOf `?? 0` 兜底；smoke 断言（3d0f2c2） |
| R6 | **remainingRounds NaN 污染**——`remaining=abc` / 工具宽松传值把 NaN 传入 assess（NaN 能通过 `!== null`），官方定价激活时文案显示 ¥NaN/$NaN | **fixed** | command 解析加 Number.isFinite+≥0 守卫；assess 开头归一化 NaN→null，economyUpgrade/文案/expectedTotal 统一读归一化值；smoke +2（6d5055f） |
| R7 | README 双语「/compass — 全部探测」与 processes 默认关闭矛盾 | **fixed** | 描述纠错（a34ae1f） |
| R8 | readBody 错误契约经 catch 隐式传递 | **recorded** | 复核 P3 防御性建议；当前 413/400 判定正确，重构非阻塞 |
| R9 | fs.resolve 的 cwd 限定/符号链接行为未确认 | **recorded** | 复核 P3；仅回报布尔存在性，泄露面可接受；sandbox 边界由 fs 服务承担 |
| R10 | remaining=1e9 断言仅查无 NaN 文本 | **fixed** | 补 expectedTotal 全 null 精确断言（4d5ce5f，复核 P3 收敛） |
| R11 | 面板 modal 无焦点 trap（Tab 可逃出） | **recorded** | 轻量面板改进项，非正确性问题 |
| R12 | probeProcesses 目录名短（≤2 字符）不参与 base 匹配 | **recorded** | 既有行为，markers 兜底；低误报/漏报权衡 |

## 第四轮独立复核（子代理 be61edcb，对 3173f5c/a34ae1f/3d0f2c2 + 工作区状态）
- readBody 413：**确认正确**（流立即中止、状态传递无误、不吞真实错误）
- safeRelativeName：**确认正确**（绝对/UNC/盘符/`..` 全拒，相对子目录符合设计）
- 配置关闭标注：**确认正确，无回归**（minimal 守卫挡住新增分支，三态互斥）
- formatCompact guard：**确认正确**（k=1000→1M、1050→1.1M、1999→2M 可接受）
- NaN 防御：**确认正确**（typeof 0 不误伤、跳过不写 0 桶、双保险）
- 新测试：**确认有效**（断言精确无恒真）
- 遗漏消费点：**无遗漏**
- 结论：**可发布**（无 P0-P2；3 项 P3 建议，R8/R9 记录、R10 已收敛）

## 修复后全链验证
- `npm run build` + `npm run smoke`（**70 项**）+ mount + client-mount + typecheck（strict）：**全绿**
- visual 套件：**5 项通过 + 1 skip**（浮层 B2/B3，待 0.7.11 部署后启用）

## 结论
第四轮共 **7 项 fixed**（R1-R7、R10）、**4 项 recorded**（R8/R9/R11/R12，均附理由）。**无残留 open 项**；独立复核确认可发布。**发布前待办**：tag `context-compass-v0.7.11` 需前推到 HEAD（`4d5ce5f`）或 bump 版本（用户决定时机）。

---

# 追加审计：2026-08-19 第五轮（穷举全维度——性能/可靠性/并发/依赖/国际化/XSS/打包/契约/状态/可维护性/可观测性/测试质量）

- 固定点：`c3ad34d`（0.7.12 发布后，visual 适配提交）
- 方法：12 个质量维度系统性枚举 + 第五轮独立复核子代理
- 提交：`ec6887c`（logger/schema/格式化单点）、`ecffcda`（NaN 纵深防御）、`b349f50`（renderToolText/500 测试）、`c39ae1d`（复核 P3 收敛）

## 发现与处置

| # | 维度 | 发现 | 状态 | 证据 / 裁决 |
|---|---|---|---|---|
| P5-1 | 可观测性 | pricing refresh 失败完全静默——部署者无法知道价格停留在静态兜底 | **fixed** | refresh/refreshAny 加 onError 回调（默认静默向后兼容）；startPricingRefresh 用 ctx.logger.warn 记录（ec6887c） |
| P5-2 | API 契约 | signals.compactions 实现恒返回但 schema 未标 required | **fixed** | schema 标 required:true；execute 返回值类型显式化（ec6887c） |
| P5-3 | 可维护性 | client.tsx 三个格式化函数副本（compact/pctOf/formatUsd）与 util.ts 双源 | **fixed** | import util.ts 单点（formatCompact/formatUsd/formatHitRate），compact 只留 null 守卫；tree-shake 验证只保留引用函数（ec6887c） |
| P5-4 | 可靠性 | measureTokens/resolveWindow 的 typeof number 放行 NaN/Infinity（异常适配器）——assess signals 不走 zod schema 会泄漏 | **fixed** | Number.isFinite 守卫（NaN/Infinity → null）（ecffcda） |
| P5-5 | 可靠性 | util 四个格式化函数对 NaN/Infinity 输出 $NaN/¥NaN/NaN% | **fixed** | 返回 '—'（纵深最后防线）（ecffcda） |
| P5-6 | 可靠性 | renderToolText 的 compactionRatio 无 isFinite（理论 NaN%） | **fixed** | 补守卫（b349f50） |
| P5-7 | 测试质量 | overview rpc 500 路径未测（buildOverview 全 catch，500 由 summary 的 assess 触发） | **fixed** | +1 测试（sessions.get 抛错 → 500）（b349f50） |
| P5-8 | 一致性 | overview/command/knowledge 的 compactionRatio 守卫缺 isFinite（与 tool/util 不一致） | **fixed** | 全链对齐（c39ae1d） |
| P5-9 | 测试质量 | onError 回调无测试（复核 P3） | **fixed** | +1 测试（两 URL 失败/回退成功/默认静默）（c39ae1d） |
| P5-10 | 依赖安全 | — | **recorded** | npm audit 0 漏洞；peer 范围与 harness 一致；client bundle 纯外部依赖（react 仅）无 zod 内联 |
| P5-11 | 打包 | — | **recorded** | client.js 58-60KB；tree-shake 完美（probeCrossSession/buildSnapshotText/formatCny 全摇掉） |
| P5-12 | XSS/客户端安全 | — | **recorded** | 无 dangerouslySetInnerHTML/innerHTML/eval/href 注入；React 默认转义 |
| P5-13 | 国际化 | host 输出（tool/command/assess/overview）全中文 | **recorded** | 设计决策（DSH 中文生态）；工具 schema enum 值英文机器可读；客户端 locale 判断（zh→CNY 否则 USD）正确 |
| P5-14 | 状态管理 | — | **recorded** | localStorage 键带插件前缀 + 值严格校验 + try/catch；投影状态 schema 校验闭环（healthView 16 字段全过 strict） |
| P5-15 | 并发竞态 | titleCache 模块级全局跨插件重挂载残留；RPC 并发冷加载重复读盘 | **recorded** | 低危（展示性数据/幂等读）；fillSignal 已 abort 后 fill 无害 |
| P5-16 | schema/类型跨声明漂移 | tool schema（JSON 字面量）与 TS 返回类型两份独立声明 | **recorded** | 既有架构限制（复核 P3）；未来漂移靠人工——signal required 已显式化 |

## 第五轮独立复核（子代理 815f790c，对 ec6887c/ecffcda + 工作区）
- onError 回调：**确认正确**（末尾参数无移位、默认静默、logger 调用正确）
- signals.compactions required：**确认正确**（恒赋值；schema/类型跨声明漂移属架构局限）
- 格式化单点化：**确认正确**（tree-shake 验证、行为逐分支等价、局部 pctOf 未被误删）
- isFinite 守卫：**确认正确**（1e15 不受影响；Infinity 窗口语义变更是刻意改进）
- '—' 占位符：**确认正确**（输入侧守卫堵死，纯最后防线）
- 新测试：**确认有效**（500 路径真实触发；renderToolText 守卫不可达补测价值低）
- 结论：**可发布**（3 项 P3 建议：P5-9 已修、P5-16 记录、P5-8 已修）

## 修复后全链验证
- `npm run build` + `npm run smoke`（**74 项**）+ mount + client-mount + typecheck（strict）：**全绿**
- visual 套件：**6 项通过 + 0 skip**（0.7.12 部署后 B2/B3 浮层测试已启用）

## 结论
第五轮共 **9 项 fixed**（P5-1 至 P5-9）、**7 项 recorded**（P5-10 至 P5-16，均附理由）。**无残留 open 项**；独立复核确认可发布。五轮累计：**31 项 fixed + 16 项 recorded（0 残留）**。

---

# 追加审计：2026-08-19 第六轮（死代码/数值/时间/文档/构建严格性）

- 固定点：`c39ae1d`（第五轮复核 P3 收敛后）
- 方法：死代码/未使用导出（tsc noUnusedLocals）、数值精度链、时间/时区、边界值穷举、README 逐行核对、构建配置严格性、第六轮独立复核子代理
- 提交：`aa48fd1`

## 发现与处置

| # | 维度 | 发现 | 状态 | 证据 / 裁决 |
|---|---|---|---|---|
| S6-1 | 死代码 | assess.ts import 了未使用的 applyHealthEvent（noUnusedLocals 抓出） | **fixed** | 删除 import（aa48fd1） |
| S6-2 | 死代码 | resolveWindow 的 session 参数未使用（YAGNI） | **fixed** | 删参数 + 注释同步（aa48fd1） |
| S6-3 | 构建严格性 | tsconfig.build.json strict:false + noUnusedLocals:false——死代码/宽松类型构建不抓（D1 即漏网例） | **fixed** | 对齐 strict:true + noUnusedLocals/Parameters；strict 构建验证 0 错误（aa48fd1） |
| S6-4 | 文档 | README 双语 patch 示例 id `session-health`（旧名）与 cordis.patch.yml 的 `context-compass` 不一致 | **fixed** | 改为 context-compass（aa48fd1） |
| S6-5 | 文档 | README 信号表进程行未说明默认关闭 | **fixed** | 补「默认关闭——/compass processes 或配置启用」（aa48fd1） |
| S6-6 | 数值精度 | formatUsd(0.007) → $0.01（43% 显示误差） | **recorded** | 美分是货币最小显示单位，业界惯例；真实成本显示合理 |
| S6-7 | 时间/时区 | beijingMinutes 固定 UTC+8（北京无 DST）正确；summary 用 UTC ISO、卡片用本地时间 | **recorded** | 设计决策（机器格式 vs 人读）；无 DST bug |
| S6-8 | 边界值 | 空会话/0 压力/remaining=0 全无崩溃无 NaN | **recorded** | 穷举验证通过 |
| S6-9 | 测试质量 | 40 处精确值断言 + 文案断言；GIT_OUT stub 白盒耦合 | **recorded** | 行为验证可接受 |
| S6-10 | TS 严格性 | 零 any；unknown 均为外部服务 loose face | **recorded** | 生态模式，有运行时守卫 |
| S6-11 | 依赖升级 | peer ^0.1.0-rc.6 兼容 rc.7；react 18.3 满足；无阻塞升级 | **recorded** | npm outdated 核对 |
| S6-12 | 状态/集成 | tip 状态刷新后旧 rowId 残留（守卫防错显）；readCounts fallback 与投影 turns 口径差异（事件语义层） | **recorded** | 低危展示性/设计使然 |

## 第六轮独立复核（子代理 d4df50c8）
- applyHealthEvent 删除：**确认正确**（仅 healthView 使用，tsc 零错误）
- resolveWindow 删参：**确认正确**（编译即证无漏网；YAGNI 合理；注释 P3 已同步）
- README id 修正：**确认正确**（残留 session-health 均为方法论/历史/内部 slot 引用，非插件 id）
- 结论：**可发布**（P3 注释已收敛）

## 修复后全链验证
- `npm run build`（**strict**）+ `npm run smoke`（**74 项**）+ mount + client-mount + typecheck：**全绿**
- visual 套件：**6 项通过 + 0 skip**

## 结论
第六轮共 **5 项 fixed**（S6-1 至 S6-5）、**7 项 recorded**（S6-6 至 S6-12，均附理由）。**无残留 open 项**；独立复核确认可发布。**六轮累计：36 项 fixed + 23 项 recorded（0 残留）**。

## 发布评估（第六轮后）
第五、六轮修复（logger/schema/格式化单点/NaN 纵深防御/死代码/构建严格性/文档）均**未发布**——npm 0.7.12 落后当前 HEAD 10 个提交。其中 S6-3（构建严格性）与 P5 系列是质量加固非功能缺陷，无紧急发布压力；但为保持 npm 与 HEAD 一致，建议 bump **0.7.13** 发布（用户决定时机）。

---

# 追加审计：2026-08-19 第七轮（极端环境降级穷举 / 未深挖分支 / 数值边界 / 字符串一致性 / 注入复核）

- 固定点：`aa48fd1`（第六轮审计后，HEAD）
- 方法：逐文件通读 + 六方向穷举（overview 退化路径 / pricing 极端降级 / healthView 边界 / client 渲染健壮性 / 文案三方一致性 / sessionId 注入复核）+ 全链验证；子代理并行审计因会话失败未产出，改为主代理人工穷举
- 提交：`6dfc6b2`（会话接手时 clamp 遗留提交）、`9a84382`、`d6a96b2`、`542fa16`、`fc55c96`，均在 main

## 发现与处置

| # | 维度 | 发现 | 状态 | 证据 / 裁决 |
|---|---|---|---|---|
| V7-1 | 一致性 | **context_compass 工具 `windowPercent` 未截断 100%**——前六轮已把 assess/projection/command 的「已占窗口%」显示统一截断到 100（ratio 可因口径差 >1），但工具输出 `signals.windowPercent`（tool.ts:163）仍裸 `Math.round(ratio*100)` → 模型可见 120% 之类误导值 | **fixed** | tool.ts 加 `Math.min(...,100)`；smoke 新用例（ratio 1.5 → windowPercent=100）（9a84382） |
| V7-2 | 一致性 | **`buildHandoffSummary` pct 未截断**（overview.ts:368）——交接摘要的「（窗口 N%）」与其余三处不一致，ratio>1 时显示 >100% | **fixed** | 加 `Math.min(...,100)`；smoke 新用例（ratio 1.5 → （窗口 100%））（9a84382） |
| V7-3 | client 健壮性 | **client CNY 金额绕过 `formatCny`**——client.tsx 两处（徽章 money、overview `moneyOf`）用裸 `cny.toFixed(2)`，而 USD 走 `formatUsd`（有 isFinite 守卫）——非有限值泄漏 ¥NaN 的纵深防御缺口（zod 校验应挡，但格式路径不一致） | **fixed** | client.tsx 导入并改用 `formatCny`（单点算法，与 util.ts 同步）（9a84382） |
| V7-4 | pricing 可靠性 | **`validDocument` 大文档无牌**——`refresh` 直接 `response.json()`，CDN 若托管超大文件解析阶段可 OOM（10s 超时是软上限） | **fixed** | refresh 加 `MAX_DOC_BYTES=1MB` Content-Length 上限守卫：超限拒绝（onError「pricing document too large」）、缺失头回退解析；smoke 新用例（5MB 拒/无头正常解析）（fc55c96） |
| V7-5 | pricing 可靠性 | **fetch 超时路径无直接测试**——`AbortSignal.timeout` 触发 AbortError 是否走 catch→false→静态兜底未锁（前轮测了失败/回退/onError，未测超时专用异常） | **fixed** | smoke 新用例（AbortError→false→静态兜底；已有好价在超时后保留 last-good-wins）（542fa16） |
| V7-6 | overview 退化 | **`workspaceRegistry.list()` 抛错/`archivedSessionIds` 访问抛错路径未测**——代码有 try/catch（降级 ungrouped），但无测试锁定 | **fixed** | smoke 新用例（list 抛错 + archived access 抛错 → 4 行全在、`workspace:null`、不抛）（d6a96b2） |
| V7-7 | healthView 边界 | **ratio>1 pct 截断 + window=0 退化无直接测试**——healthView 的 `Math.min(...,100)` clamp 与 window≤0 跳过 ratio 的边界未单测（被子代理/工具路径间接覆盖但不直接） | **fixed** | smoke 新用例（ratio 1.5 → advice 100% 且 ratio 保留 1.5；window=0 → ratio null / green / 无 NaN）（d6a96b2） |
| V7-8 | 文案一致性 | 客户端 4 字档位/命令完整档位/工具 prose 描述措辞不同 | **recorded** | 三处语义对齐、register 各异（client 压缩 chip、command 完整结论、tool 面向模型的 prose），已文档化为刻意设计（client.tsx:195 注释）；README 判定表与健康档一致，无误导 |
| V7-9 | 注入 | sessionId（RPC）/handoffDoc（工具）/doc=（命令）流经 fs/subprocess 的路径 | **recorded** | 复核确认：sessionId 仅达内部 map 查找（sessions.get/agents.get），永不触 fs/命令；handoffDoc/doc= 经 safeRelativeName 白名单（拒绝对路径/`..`）才达 fs.resolve；loopback-only 加 body 16KB 上限，无注入面 |

## 已记录候选低价可修性重评估（第六轮记录 23 项）
- **R11 面板 modal 无焦点 trap**：非低成本（需可测试的 trap + 键盘序列），且监督面板无敏感输入，判保留
- **R8 readBody 错误契约 / T8 refreshAny 串行 / S4 无鉴权**：均有确切设计理由（loopback 边界、有序回退特性），改造成本>收益，判保留
- 其余 recorded 项（P5-10~16、S6-6~12、T6~10 等）经复核：无一为低成本可立即修复的实际缺陷，维持记录
- **结论**：本轮 recorded 候选均非低成本可修，不新增入账

## 修复后全链验证
- `npm run build`（strict）+ `npm run smoke`（**81 项**）+ mount + client-mount + typecheck（strict）：**全绿**
- visual 套件：**6 项通过 + 0 skip**

## 结论
第七轮共 **7 项 fixed**（V7-1 至 V7-7）、**2 项 recorded**（V7-8/V7-9，均附理由）。**无残留 open 项**。**七轮累计：43 项 fixed + 25 项 recorded（0 残留）**。第六轮 `6dfc6b2` 的 ratio 截断 100% 遗留提交（会话接手前）已核算入本轮。

## 发布评估（第七轮后）
修复均为质量加固（ratio 截断一致性、CNY 格式单点、大文档防御、测试补强）——非功能缺陷，无紧急发布压力；HEAD 现比 npm 0.7.12 领先 13 个提交，**bump 0.7.13 发布建议维持**（用户决定时机）。

# 追加审计：2026-08-19 第八轮（数值归一化单一权威 / 跨界一致性）

> 交接说明：本轮由「接手」会话发起并完成代码与用例，但因会话反复截断未提交、未跑全链，仅在最后一条消息发出 git 核查命令即中断。由接收方会话接手：核验改动 → 全链验证全绿 → 提交 `b05d9bc` 并回填本记录。

- 固定点：`fc55c96`（第七轮审计后，HEAD）
- 方法：横向核对 `remainingRounds` 在 命令解析层 / assess 归一化层 / 工具回显层 三处的口径是否一致
- 提交：`b05d9bc`（第八轮，在 main）

## 发现与处置

| # | 维度 | 发现 | 状态 | 证据 / 裁决 |
|---|---|---|---|---|
| V8-1 | 数值归一化/一致性 | **assess 对负数 `remainingRounds` 未归一化**——`/compass` 命令解析层已拦截 `>=0`，但工具路径 schema 未设 minimum、直调 assess 的调用方不受命令层保护；assess 归一化仅 `isFinite`（`!== null` 能通过），负数会直接参与乘法产出负费用预期（-¥0.3 / -$0.04）污染工具输出 | **fixed** | assess.ts 归一化扩为 `isFinite && >=0`（与命令层单一权威一致）；tool.ts 仅回显非负有限轮数并更新参数描述；smoke 新用例（直调 assess + 工具路径，负数→expectedTotal*=null、不回显、黄色不因负数升级、`[¥$]-` 不出现在报告）（b05d9bc） |

## 修复后全链验证
- `npm run build`（strict）+ `npm run smoke`（**82 项**）+ mount + client-mount + typecheck（strict）：**全绿**
- visual 套件：**6 项通过 + 0 skip**

## 结论
第八轮共 **1 项 fixed**（V8-1）、**0 项 recorded**。**无残留 open 项**。**八轮累计：44 项 fixed + 25 项 recorded（0 残留）**。

## 发布评估（第八轮后）
修复为数值归一化兜底（防负数污染输出），非功能缺陷；HEAD 现比 npm 0.7.12 **领先 14 个提交**（含 `b05d9bc`），**bump 0.7.13 发布建议维持**（用户决定时机）。
