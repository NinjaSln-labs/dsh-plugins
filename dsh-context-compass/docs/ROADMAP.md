# dsh-context-compass — Roadmap

状态基准：**v0.7.13**（2026-08-19 发布，十二轮审计完结）。本文件是路线图的**唯一权威来源（单源）**；`HANDOFF.md` / `DESIGN.md` / `OPTIMIZATION-RESEARCH.md` 只记录 delta 并引用本文件，不复制路线内容。

## 已交付（到 v0.7.13）

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

## 待做（按优先级）

| # | 项 | 优先级 | 动机 / 价值 | 依赖 |
|---|---|---|---|---|
| R1 | **占用趋势 sparkline**（浮层「上下文占用」行下方） | P1 | 竞品空白；一眼看出稳步上升 vs 压缩后回落 | 投影加 `pressureHistory`（stateVersion 8→9）+ 客户端 SVG/CSS 渲染 |
| R2 | **压缩触发频率**（「已压缩 N 次」补「平均每 X 轮一次」） | P2 | 提前预警任务切太碎 / 上下文膨太快 | 无（`turns / compactions` 已有，纯展示）|
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
| **0.7.14** | README 元数据 + star 徽章（已 commit 未发布）|
| **0.8.0** | R1 占用趋势 sparkline + R2 压缩频率 |
| **0.9.0** | R3 定价同步 CI + R4 阈值回写 |
| **远期** | B1 / B2（等依赖就绪）· R5 / R6（渐进增强）|

## 维护规则

- 本文件是路线图的**唯一权威来源**；完成一项 → 从「待做」移到「已交付」并标注落地版本
- 被阻塞项保留在「被阻塞」并写明卡点；卡点解除后移回「待做」
- 优先级/排期变化只改这里；`HANDOFF.md` / `DESIGN.md` / `OPTIMIZATION-RESEARCH.md` 引用本文件、不复制路线内容