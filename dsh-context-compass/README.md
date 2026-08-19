# dsh-context-compass

[English](README.en.md) | 简体中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的上下文罗盘插件：基于真实数据的「继续 vs 新开会话」指示器。

- **头部徽章** — 会话日志按钮旁的有色圆点 + 边框（绿/蓝/黄/红），使用 DSH 主题令牌。**响应式**：完全由宿主计算的 `sessionHealth` 投影驱动（推送帧——这是社区插件唯一可用的线上数据通道；客户端 Remote 是构建期固定清单，因此本插件无 Remote、无轮询）。悬停显示建议、窗口占用条、每轮 token 成本与**缓存命中率**（命中率是上下文稳定度的表现；压缩会重置命中）、压缩感知的**预计下次输入（剔除缓存命中）**、**计费预期（金额）**（zh 界面显示 CNY，否则 USD——官方峰谷定价，标注 `忙时价/闲时价`）、模型窗口、会话规模与压缩次数（含**上次压缩比例**——按压缩前后压力快照差值推断，标「快照口径」）。压缩后判定滞后（severity 判定基于压缩前压力、占用条已按下次请求重估）时提示「**下次请求后更新**」。**点击运行 `/compass`** 查看完整报告。支持键盘操作。
- **`/compass` 命令** — 完整文本报告，可选探测：
  - `/compass` — 全部（git / 交接文档 / 进程探测，可配置）
  - `/compass minimal` — 仅核心指标（token / 窗口 / 规模）
  - `/compass no-git` / `/compass no-handoff` — 跳过某项探测
  - `/compass doc=<你的文件名>` — 检查你自己的交接文档（不预设文件名；概念是你的，名字也是你的）
  - `/compass remaining=<轮数>` — 费用预期（金额）：`每轮成本 × 剩余轮数 ≈ 预计输入花费`（含缓存折扣）
  - `/compass processes` — 强制进程探测
- **`context_compass` 工具** — 模型可调用的只读评估（长任务自查）：结构化结论（`severity` / `recommendation` / `signals` / `cost` / `handoffReady`），黄/红档附带完整 markdown 报告。工作性质问题由模型自查（`dependsOnEarly` / `earlyDecisionRecorded` / `remainingRounds`），其余全部由宿主精确测量。
- **`sessionHealth` 投影** — 宿主计算的持久折叠（轮次、消息数、压缩次数、last-wins 压力/窗口、上次请求缓存桶、**上次压缩比例**、severity + 建议）推送到所有客户端；重放与页面刷新后依然存活。
- **多会话罗盘一览面板**（v0.6.0）— 侧栏底部「设置」旁的「罗盘一览」按钮打开全屏面板（`shell.overlay`），列出**所有会话**的健康判定。数据走同源宿主 RPC（`/context-compass-rpc`，仅 loopback）：在线会话切投影注册表快照，冷会话读持久化投影缓存（异步 cold load 兜底）；标题来自日志折叠 / 批量查询。行按红 → 黄 → 蓝 → 绿 → 无数据排序（同档内 **运行中 > 已加载 > 冷却**，再新会话在前），面板打开期间每 5 秒刷新；点击行打开该会话并运行 `/compass`。状态列三态——**运行中**（智能体正在处理回回合，与侧栏「进行中」同源）、**已加载**（内存驻留待命）、**冷却**（仅持久化）。Esc / 点遮罩关闭；键盘与读屏可达（severity 从不只靠颜色传达）。

## 交接清单（自动化）

黄/红档时，`/compass` 追加**真实状态清单**而非静态文案：`git status --short` / `git log --oneline -1` / `git status -sb`（经 `ctx.subprocess` 的只读白名单 argv）驱动 commit/push 项，交接文档探测驱动文档项，进程探测驱动进程项。无法检查的项标记 `[ ]` 并说明原因——绝不静默显示「已完成」。

## 知识库联动（解耦，v0.7.2）

不绑定任何特定知识库插件（未装则跳过）：

- `/compass` 报告尾部附**结构化交接快照段**（固定键名 `context-compass-handoff-snapshot`：severity / recommendation / compacted / compression_ratio / uncommitted / handoff_ready / timestamp）——纯文本、可 grep，任何记忆/知识插件或用户都能摄取（如 `knowledge_write` 存入库）。
- **可选探测** `ctx.get('knowledge')`：存在（如 dsh-knowledge-sqlite）则在新会话用其只读 `search()` 检索历史快照，给 `/compass` 加一段「跨会话回顾（上次会话 severity/交接就绪…）」；不存在则 probe 一行「知识库未安装，跳过」。写入面留给用户/模型显式调用（自带 ask 门控），插件不越权。

## 判定模型

二维「继续 vs 切换」（社区 session-health 方法论），参数在插件配置中：

| 档位 | 条件（默认） | 建议 |
|---|---|---|
| 绿 | 窗口占比 < 30%，每轮计费当量 < 50K | 放心继续 |
| 蓝 | 占比 30–50%，或消息数 ≥ 800（代理指标） | 继续，留意窗口 |
| 黄 | 占比 ≥ 50%，或每轮计费当量 ≥ max(50K, 30% × 窗口) | 在下一个任务边界收尾 |
| 红 | 占比 ≥ 80% | 尽快收尾并交接 |

按方法论，经济成本（每轮计费当量，含缓存折扣）优先于容量（窗口占比）。经济门槛随窗口缩放（`economyWindowRatio`）：50K 绝对默认按 ~128K 窗口模型校准，若在大窗口模型上仍用裸值，会在个位数占比时就误报黄色——现在计费当量不达标就不会黄。当工作依赖从未记录（git/文档）的早期内容时，工具升级为 `danger-zone`——绝不建议裸切。

## 配置

```ts
// thresholds: 判定模型参数
thresholds: {
  windowMid: 0.3, windowHigh: 0.5, windowCritical: 0.8,   // 窗口占比档位
  economyTokenFloor: 50000, economyWindowRatio: 0.3,      // 经济维度（计费当量 ≥ max(50K, 30%×窗口) 才黄）
  economyRoundFloor: 10,                                  // 剩余轮数阈值：工具/命令带剩余 ≥10 轮时经济档升级
  messageCountProxy: 800,                                  // 上下文膨胀代理指标（随窗口缩放：max(800, 0.2%×窗口)）
  messageCountWindowRatio: 0.002,                          // 代理指标随窗口缩放比例（1M 窗口 → 2000 条）
}
// checks: 探测开关（全部只读）
checks: {
  git: { enabled: true, workspaceRoot?: string },          // .git 存在性探测
  handoff: { enabled: true, paths: [] },                   // 你的交接文档文件名
  sessionResume: { enabled: true },                        // DSH 持久化说明
  processes: { enabled: false },                           // 运行中进程检测（增量信号，默认关闭；/compass processes 强制开启）
}
projection: { enabled: true }                              // 响应式徽章单元
cost: {
  cacheHitDiscount: 0.1,       // 缓存命中价格比例
  inputPricePerM: 0.28,        // 静态兜底：USD / 1M 输入 token
  priceSource: 'auto',         // 'auto'：定期拉取；'static'：从不拉取
  priceUrl: 'https://cdn.jsdelivr.net/gh/NinjaSln-labs/dsh-plugins@main/pricing/deepseek.json',   // 主源（jsdelivr，CN 可达）
  priceFallbackUrl: 'https://raw.githubusercontent.com/NinjaSln-labs/dsh-plugins/main/pricing/deepseek.json', // 同轮回退（GitHub raw）
  priceRefreshHours: 24,
}
```

## 价格（金额显示）

harness 不携带价格数据，金额显示通过实时缓存解析，数据源为**官方 DeepSeek 定价文档**
（默认 `priceUrl` = jsdelivr CDN 镜像，`priceFallbackUrl` = GitHub raw 同轮回退；
文档即本仓库维护的 [`pricing/deepseek.json`](../../../pricing/deepseek.json)，
与 [api-docs.deepseek.com](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) 同步）。
主源不可达时（如部分网络屏蔽 GitHub raw）自动回退，避免金额显示降级为静态 USD。

- **峰谷定价**：每次读取按**北京时间**判定时段——高峰 9:00–12:00 / 14:00–18:00
  （英文页写作 UTC 01–04 / 06–10），其余闲时半价；badge 标注 `忙时价/闲时价`。
- **按模型**：按当前模型名取价（`models."*"` 兜底）。**双官方币种**——CNY 来自中文页，
  **USD 直接取自英文页官方价**（无汇率换算）：v4-flash 闲时 未命中 ¥1.5/M / $0.22/M、
  命中 ¥0.05/M / $0.007/M；忙时 ¥3.0/M / $0.44/M、¥0.10/M / $0.014/M。
- **按地区选币种**：应用界面为 zh 时显示 CNY，否则 USD；`/compass` 双币并列。
- 每 `priceRefreshHours`（默认 24h）刷新；失败保留上次有效文档；首次成功前（或
  `priceSource: 'static'` 时）用静态 `inputPricePerM` / `cacheHitDiscount`（平价 USD，无时段）。

文档格式（每个时段双币必填）：
`{ "peakHours": [[9,12],[14,18]], "models": { "<模型名>": { "peak": { "inputMissPerMCny": 3.0, "inputHitPerMCny": 0.10, "inputMissPerMUsd": 0.44, "inputHitPerMUsd": 0.014 }, "offpeak": { ... } }, "*": { ... } } }`

## 为什么用真实数据

每个信号都来自 harness 本身——无任何估算：

| 信号 | 来源 |
|---|---|
| 每轮输入 token | `ctx.tokenMeter.measure`（精确，快照口径） |
| 上下文窗口 | `llm.resolveModelInfo`（如 deepseek-v4-pro 的 1M） |
| 消息 / 轮次 / 压缩次数 / 缓存桶 / 压缩比例 | `sessionHealth` 投影折叠（sessionQuery 兜底；压缩比例 = 折叠内 1 − 压缩后/压缩前压力快照，快照口径） |
| 下次请求占用 | token-meter `contextPressure.projectedTokens`（压缩感知） |
| git 仓库 + 工作树状态 | `fs` 探测 + 只读 git 子命令 |
| 交接文档 | 探测**你提供**的文件名 |
| 运行中进程 | `ctx.subprocess` 只读 `ps` 探测，按工作区过滤 |

## 安装

```sh
dsh plugin add dsh-context-compass
# 然后重启 / 重载挂载它的 profile
```

或加入 profile 补丁层：

```yaml
# 你的 profile cordis.patch.yml
- insert:
    - id: session-health
      name: 'dsh-context-compass'
```

## 开发

```sh
npm run build      # tsc → lib/ + esbuild 客户端 bundle
npm run typecheck  # 严格类型检查
npm run smoke      # 逻辑冒烟测试（stub 服务）
npm run mount      # 真实 cordis 挂载测试（命令 + 工具 + 投影）
npm run build:client && node scripts/client-mount.mjs  # 浏览器启动路径测试
npm run visual     # Playwright 视觉回归（只读，不污染会话：panel RPC mock 矩阵 明/暗×四档×分页 + 徽章 hover 桥接层 e2e）
npm run visual:update  # 有意变更视觉后重写基线（visual/baselines/）
```

## 设计

方法论源自社区 session-health 技能（二维继续-vs-切换模型）；harness 版本把数据层从估算升级为精确测量。完整设计笔记（信号映射、判定模型、可配置检查项、phase-2 路线图）位于插件开发工作区的 `research/session-health-plugin/DESIGN.md`。

## License

MIT
