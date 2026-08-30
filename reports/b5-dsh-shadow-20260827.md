# B.5 dsh 影子周报

- 生成时间：2026-08-27T17:35:46+08:00
- 数据源：`/home/shadow/.dsh/slm-shadow/session-slm-shadow.jsonl`（总行数 253，其中预测失败 27 条）
- 覆盖天数：2

**GATE: MET**（门槛：N≥100 或 天数≥3；当前 N=226）

| 指标 | 值 |
|------|----|
| N（有效影子条数 predict_ok=true） | 226 |
| 建议弱档率 | 163（72.1%） |
| 实际弱档率 | 203（89.8%） |
| 一致率 agree=true | 143（63.3%） |
| 本该换弱 switch_to_weak（省成本机会） | 5（2.2%） |
| 本该换强 switch_to_strong（质量风险·优先抽检） | 61（27.0%） |
| 目标不健康率（would_bind 且 target unhealthy） | 0（0.0%） |
| 弃权率 abstained=true | 28（12.4%） |
| p95 predict_ms | 239ms |

## 抽检建议

- 存在 61 条「本该换强」——按计划优先抽检这些轮次（质量风险）。筛选命令：`grep switch_to_strong <log>` 后对照 utterance_preview。
- 存在 5 条「本该换弱」——省成本机会，S3 授权前仅记录。
