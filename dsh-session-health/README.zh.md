# dsh-session-health

[English](README.md) | [中文](README.zh.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的会话健康插件：基于真实数据的「继续 vs 新开会话」指示器。

- **头部徽章** — 会话日志按钮旁的有色圆点 + 边框（绿/蓝/黄/红），使用 DSH 主题令牌。**响应式**：完全由宿主计算的 `sessionHealth` 投影驱动（推送帧——这是社区插件唯一可用的线上数据通道；客户端 Remote 是构建期固定清单，因此本插件无 Remote、无轮询）。悬停显示建议、窗口占用条、每轮 token 成本与**缓存命中率**（命中率是上下文稳定度的表现；压缩会重置命中）、压缩感知的**预计下次输入（剔除缓存命中）**、**计费预期**（未缓存输入 + 缓存命中×折扣，`cost.cacheHitDiscount` 可配）、模型窗口、会话规模与压缩次数。**点击运行 `/health`** 查看完整报告。支持键盘操作。
- **`/health` 命令** — 完整文本报告，可选探测：
  - `/health` — 全部（git / 交接文档 / 进程探测，可配置）
  - `/health minimal` — 仅核心指标（token / 窗口 / 规模）
  - `/health no-git` / `/health no-handoff` — 跳过某项探测
  - `/health doc=<你的文件名>` — 检查你自己的交接文档（不预设文件名；概念是你的，名字也是你的）
  - `/health remaining=<轮数>` — 费用预期：`计费当量 × 剩余轮数 ≈ 输入费用预期`（含缓存折扣）
  - `/health processes` — 强制进程探测
- **`session_health` 工具** — 模型可调用的只读评估（长任务自查）：结构化结论（`severity` / `recommendation` / `signals` / `cost` / `handoffReady`），黄/红档附带完整 markdown 报告。工作性质问题由模型自查（`dependsOnEarly` / `earlyDecisionRecorded` / `remainingRounds`），其余全部由宿主精确测量。
- **`sessionHealth` 投影** — 宿主计算的持久折叠（轮次、消息数、压缩次数、last-wins 压力/窗口、上次请求缓存桶、severity + 建议）推送到所有客户端；重放与页面刷新后依然存活。

## 交接清单（自动化）

黄/红档时，`/health` 追加**真实状态清单**而非静态文案：`git status --short` / `git log --oneline -1` / `git status -sb`（经 `ctx.subprocess` 的只读白名单 argv）驱动 commit/push 项，交接文档探测驱动文档项，进程探测驱动进程项。无法检查的项标记 `[ ]` 并说明原因——绝不静默显示「已完成」。

## 判定模型

二维「继续 vs 切换」（社区 session-health 方法论），参数在插件配置中：

| 档位 | 条件（默认） | 建议 |
|---|---|---|
| 绿 | 窗口占比 < 30%，每轮 < 50K | 放心继续 |
| 蓝 | 占比 30–50%，或消息数 ≥ 800（代理指标） | 继续，留意窗口 |
| 黄 | 占比 ≥ 50% 或每轮 ≥ 50K | 在下一个任务边界收尾 |
| 红 | 占比 ≥ 80% | 尽快收尾并交接 |

按方法论，经济成本（每轮绝对值）优先于容量（窗口占比）。当工作依赖从未记录（git/文档）的早期内容时，工具升级为 `danger-zone`——绝不建议裸切。

## 配置

```ts
// thresholds: 判定模型参数
thresholds: {
  windowMid: 0.3, windowHigh: 0.5, windowCritical: 0.8,   // 窗口占比档位
  economyTokenFloor: 50000, economyRoundFloor: 10,        // 经济维度
  messageCountProxy: 800,                                  // 上下文膨胀代理指标
}
// checks: 探测开关（全部只读）
checks: {
  git: { enabled: true, workspaceRoot?: string },          // .git 存在性探测
  handoff: { enabled: true, paths: [] },                   // 你的交接文档文件名
  sessionResume: { enabled: true },                        // DSH 持久化说明
  processes: { enabled: true },                            // 经 ctx.subprocess 的 ps 探测
}
projection: { enabled: true }                              // 响应式徽章单元
cost: { cacheHitDiscount: 0.1 }                            // 缓存命中价格比例
```

## 为什么用真实数据

每个信号都来自 harness 本身——无任何估算：

| 信号 | 来源 |
|---|---|
| 每轮输入 token | `ctx.tokenMeter.measure`（精确，快照口径） |
| 上下文窗口 | `llm.resolveModelInfo`（如 deepseek-v4-pro 的 1M） |
| 消息 / 轮次 / 压缩次数 / 缓存桶 | `sessionHealth` 投影折叠（sessionQuery 兜底） |
| 下次请求占用 | token-meter `contextPressure.projectedTokens`（压缩感知） |
| git 仓库 + 工作树状态 | `fs` 探测 + 只读 git 子命令 |
| 交接文档 | 探测**你提供**的文件名 |
| 运行中进程 | `ctx.subprocess` 只读 `ps` 探测，按工作区过滤 |

## 安装

```sh
dsh plugin add dsh-session-health
# 然后重启 / 重载挂载它的 profile
```

或加入 profile 补丁层：

```yaml
# 你的 profile cordis.patch.yml
- insert:
    - id: session-health
      name: 'dsh-session-health'
```

## 开发

```sh
npm run build      # tsc → lib/ + esbuild 客户端 bundle
npm run typecheck  # 严格类型检查
npm run smoke      # 逻辑冒烟测试（stub 服务）
npm run mount      # 真实 cordis 挂载测试（命令 + 工具 + 投影）
npm run build:client && node scripts/client-mount.mjs  # 浏览器启动路径测试
```

## 设计

方法论源自社区 session-health 技能（二维继续-vs-切换模型）；harness 版本把数据层从估算升级为精确测量。完整设计笔记（信号映射、判定模型、可配置检查项、phase-2 路线图）位于插件开发工作区的 `research/session-health-plugin/DESIGN.md`。

## License

MIT
