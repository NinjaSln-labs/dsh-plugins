# B.5 dsh 影子周报

- 生成时间：2026-08-29T11:16:26+08:00
- 数据源：`/home/shadow/.dsh/slm-shadow/session-slm-shadow.jsonl`（总行数 521，其中预测失败 62 条）
- 覆盖天数：4

**GATE: MET**（门槛：N≥100 或 天数≥3；当前 N=459）

| 指标 | 值 |
|------|----|
| N（有效影子条数 predict_ok=true） | 459 |
| 建议弱档率 | 350（76.3%） |
| 实际弱档率 | 327（71.2%） |
| 一致率 agree=true | 265（57.7%） |
| 本该换弱 switch_to_weak（省成本机会） | 64（13.9%） |
| 本该换强 switch_to_strong（质量风险·优先抽检） | 84（18.3%） |
| 目标不健康率（would_bind 且 target unhealthy） | 0（0.0%） |
| 弃权率 abstained=true | 56（12.2%） |
| p95 predict_ms | 237ms |

## 抽检建议

- 存在 84 条「本该换强」——按计划优先抽检这些轮次（质量风险）。筛选命令：`grep switch_to_strong <log>` 后对照 utterance_preview。
- 存在 64 条「本该换弱」——省成本机会，S3 授权前仅记录。

## 设计局限备注

1. **单轮 utterance 限制**：R1 分类器按单轮 utterance 训练（plan-b5-dsh.md §3.2），不传会话历史。
   「继续」「好」「OK」等短指令的含义依赖前文上下文，当前无法区分。
   这些条不计入 S3 风险评估，由实际设计方裁决是否加上下文。

2. **role=user 过滤**：过滤了 DSH 内部系统消息（goal_round/subagent report），只统计真实用户消息。

## 改进建议

1. **上下文继承**：对「继续」「好」「OK」等短指令，查上一轮的 `suggested_tier` 并继承，避免误判。
2. **规则覆盖**：对特定 pattern（如 Background subagent 完成通知）直接 skip，不送 classifier。
3. **分离表单任务**：识别 UI 表单填写类 utterance（About you/Education/Skills），可单独标记为轻量任务。
