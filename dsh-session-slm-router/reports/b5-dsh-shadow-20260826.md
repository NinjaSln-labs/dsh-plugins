# B.5 dsh 影子周报

- 生成时间：2026-08-26T14:29:14+08:00
- 数据源：`/home/shadow/.dsh/slm-shadow/session-slm-shadow.jsonl`（总行数 15，其中预测失败 3 条）
- 覆盖天数：1

**GATE: NOT MET**（门槛：N≥100 或 天数≥3；当前 N=12）

| 指标 | 值 |
|------|----|
| N（有效影子条数 predict_ok=true） | 12 |
| 建议弱档率 | 11（91.7%） |
| 实际弱档率 | 10（83.3%） |
| 一致率 agree=true | 10（83.3%） |
| 本该换弱 switch_to_weak（省成本机会） | 0（0.0%） |
| 本该换强 switch_to_strong（质量风险·优先抽检） | 0（0.0%） |
| 目标不健康率（would_bind 且 target unhealthy） | 0（0.0%） |
| 弃权率 abstained=true | 0（0.0%） |
| p95 predict_ms | 204ms |

## 抽检建议

- 样本量不足（N=12），本报告为中期快照，不作为 S3 授权依据。
