# DSH 插件开发流程（敏捷迭代版）

> 原则：**短迭代、增量交付、持续反馈、复盘沉淀**。插件开发不是一次性的瀑布工程，而是一连串小迭代——每个功能就是一个迭代，每个迭代结束都要交付可用的版本、收集反馈、复盘沉淀。
> 参考：[Scrum.org — 将 AI 风险纳入 DoD](https://www.scrum.org/resources/blog/managing-ai-risks-your-definition-done)、[SDD：AI 时代的 BDD/TDD](https://dev.to/planu/sdd-is-bddtdd-for-the-ai-era-a-guide-for-software-crafters-592p)、[ai-coding-factory 敏捷方法论](https://github.com/mitkox/ai-coding-factory/blob/master/AGILE-METHODOLOGY.md)、[Agile/Scrum + AI 结对](https://johnguerra.co/lectures/aiCoding_spring2026/07_Advanced_IDE_Agile/#/title)。

## 核心循环（一个迭代 = 一个功能）

```
Backlog ──Sprint 计划──▶ 设计决策 ──▶ 实现 ──▶ DoD 验证 ──▶ 交付试用 ──▶ 回顾
   ▲                                                                        │
   └────────────────── 反馈/新坑 进 Backlog 与速查表 ◀───────────────────────┘
```

- **迭代长度**：一个功能一个迭代（动态插件场景下通常就是一次会话/一个 pkg 版本）；多个小功能可合并一个迭代
- **每迭代只做 1-2 条 Backlog**，做完并验证才进下一个——防止"半成品堆叠"

## 1. Backlog（产品待办，用户故事格式）

所有条目用用户故事写，**体验导向**：

```
作为 <用户>，我想要 <能力>，以便 <收益>
```

三类条目统一进 Backlog，按价值排序：
- **功能**：新能力（如"作为用户，我想要任务完成时自动汇报，以便不用盯着看板"）
- **缺陷**：从用户反馈来的（如"跑完没动静"）
- **技术债**：从回顾来的（如"client half 缺失"）——不还债 = 后面更慢

## 2. Sprint 计划（迭代开始，轻量）

- 从 Backlog 顶部取 1-2 条
- **只做必要的设计决策**（不是全套设计文档）：
  - 平台与边界：host/client 各自做什么（**两个 half 都要写**）
  - 契约预检：`cordis_inspect_query` 查清用到的 Service/Event/Builtin/Slot 精确签名（动态插件尤其重要——格式错误运行时才发现 = 一个迭代白做）
  - 数据流与生命周期：状态放哪、谁写谁读、停止/更新时清理什么
  - 边界条件：空输入 / 并发 / 超时 / 取消 / 重启恢复

## 3. 实现

编码规范（动态 Cordis 插件）：

- 纯 JS，无 TS/JSX/import/require
- **沙箱禁用全局**：`setTimeout/setInterval/setImmediate/clearTimeout/clearInterval`（用 `ctx.timeout/ctx.interval`，`inject: ['timer']`）、`fetch`（用 `ctx.web`）、`process/Buffer`（用 btoa/atob/TextEncoder）、`require`（用服务）
- 服务访问：`ctx.get(name)` + undefined 检查；硬依赖才 `inject`
- 动态工具：`harness.defineTool()` 包装后再 `harness.registerTool(ctx, tool)`；`parameters` 根省略 `additionalProperties`
- **每次 define 显式提供 `code.host` 和 `code.client`**（省略 client = UI 消失，踩过 4 次）
- append 事件格式：先查系统同类事件再写（source/id/surfaceOp 对齐）

## 4. DoD（Definition of Done）——每迭代必须全部满足

> 没有验证 = 没有做完。以下清单逐项打勾，全绿才算迭代完成。

### 功能 DoD
- [ ] 用户故事描述的行为可复现（手动走一遍）
- [ ] 端到端验收任务跑通（见模板）
- [ ] 边界条件处理明确（空/并发/超时/取消/重启）

### 质量 DoD（AI 风险检查，参考 [Scrum.org](https://www.scrum.org/resources/blog/managing-ai-risks-your-definition-done)）
- [ ] `cordis_inspect_self`：state=running，**hasHostHalf 与 hasClientHalf 均为 true**
- [ ] 无沙箱禁用全局（grep setTimeout/fetch/require/process/Buffer）
- [ ] 所有 ctx 服务访问有契约依据（无猜的 API）
- [ ] 生命周期可逆（stop 后无残留进程/定时器/订阅）
- [ ] 持久化/写入路径确定（基目录明确）
- [ ] 通知/消息格式对照系统事件
- [ ] 客户端无 `client-render` 诊断；工具注册确认
- [ ] 会话日志无 command/done error；状态文件按预期生成

### 文档 DoD
- [ ] README（双语，若发布）或至少 DESIGN.md 更新（决策、接口、已知坑）
- [ ] CHANGELOG 一行记录（做了什么 + 为什么）
- [ ] 新坑已进速查表（若无则不勾）

### 端到端验收任务模板

```
/mtask 用一句话分别总结 Git 的 fast-forward、rebase、squash 三种合并策略，再综合成一段对比
```
验收点：命令返回方案 → 子代理并行 → 全部完成 → ✅ 汇报出现在对话流 → 报告文件存在 → state.json 更新。

## 5. 交付与反馈

- 交付 = 一个可运行的 pkg 版本 + 一句话变更说明（用户看得懂）
- **让用户立即试用**：给一条可直接复制的命令
- 用户的每个反馈都登记：满意点 / 不满意点 / 建议——不满意点优先转成 Backlog 缺陷条目

## 6. 回顾（Retrospective，每迭代 5 分钟）

三个问题，答案必须落盘（写进 CHANGELOG 或速查表）：

1. **这次什么顺利？**（保留的做法）
2. **这次踩了什么坑？**（新坑 → 立即进速查表）
3. **同类坑是否重复出现 ≥2 次？**（是 = 流程缺陷，先补流程再继续）

## 看板状态流

```
Backlog → In Progress → Verify(DoD) → Done
              ↑              │
              └── 未过 DoD：打回 ──┘
```

## 附录：高频坑速查表（回顾沉淀）

| 坑 | 症状 | 拦截环节 |
|---|---|---|
| 省略 client half | 看板/UI 消失 | 实现规范 + 质量 DoD |
| setTimeout 等全局定时器 | 运行时 throw | 实现规范 + 质量 DoD |
| defineTool 未包装 / parameters 违规 | host-half-failed | Sprint 计划契约预检 |
| user/message source/id/surfaceOp 格式错 | 静默被拒，状态误存 | Sprint 计划契约预检 |
| workspaceRoot 与会话 cwd 不一致 | 文件落错目录 | Sprint 计划数据流 |
| persist 防抖吞最后一次更新 | 状态丢失 | Sprint 计划边界条件 |
| 子代理提前结束（只声明意图） | 产出残缺 | 功能 DoD 验收任务 |
| 依赖任务拿不到上游产出 | 下游瞎找 | Sprint 计划数据流 |
| subagent-settled 通知默认折叠渲染 | 用户看不到汇报（收起时仅一行 summary） | Sprint 计划数据流（summary 要承载核心信息） |
| 系统 compaction 遮蔽旧消息 | 历史汇报翻不到 | Sprint 计划数据流（重要结果要落盘 + 面板常驻） |
| 通知直接 session.append 插队 | 上游 400（tool 消息无前置 tool_calls），会话卡死 | Sprint 计划数据流（必须走 agent.steer/followup 安全投递） |
| 宿主重启丢插件定义 | 动态插件全部消失 | 重建时 host+client 双全，用 .mtask/pkgs 备份源码 |
| 语料/目录迁移后 bundle 默认路径未同步 | 宿主 probe ENOENT、npm test 用例失败 | 发版前 grep 全仓路径引用（src 默认值 + tests + smoke），宿主冒烟 probe 一次 |

## 维护

- 速查表 = 回顾的沉淀物，新坑先补表再修码
- 流程本身也要迭代：回顾中发现"清单没拦住"的坑 → 改清单
