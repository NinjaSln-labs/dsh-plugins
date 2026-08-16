# CHANGELOG — dsh-knowledge-sqlite

## 0.1.3 (2026-08-16)

- **fix**: probe 语料默认路径与工作区布局一致 —— 语料迁移后 bundle 默认 `corpusPath`、
  测试 `CORPUS`、`test-smoke.mjs` 三处仍指向不存在的 `research/memory-experiment`，
  导致宿主 `knowledge_probe` 套件 ENOENT、`npm test` probe 用例失败。全部改指
  `research/memory-knowledge-seam/experiments/memory-experiment`。
- **test**: 实验语料以 fixture 形式入库（`tests/fixtures/corpus/`，逐字拷贝 + 同步说明），
  单测与冒烟脱离仓库外 `research/` 目录、CI 可跑。
- **feat**: human 套件上报 precision@1（V1.11 信息性门禁 ≥80%，单目标套件口径 ≡ recall@1，
  两臂并列如实报告）与 none 查询无误报检查（top1 必须为空或非记忆条目）。
- 回顾：发版物与工作区布局脱节是"仓库路径已修、测试/发布物未同步"的同类坑
  （详见 DEVELOPMENT.md 速查表新行）。

## 0.1.2 (2026-08-14)

- **fix**: 工具层 strict JSON —— `-0`/NaN bm25 分数归一化、`undefined` 字段省略
  （search/list 直接工具调用），测试对照 `snapshotJsonValue`。

## 0.1.1 (2026-08-14)

- **feat**: `gating` 配置（默认 `ask` 符合 V1.11；`none` 供受信部署自动放行）。

## 0.1.0 (2026-08-14)

- **feat**: 跨会话知识插件（V1.11 契约）—— `ctx.knowledge` 服务 + `knowledge_*` 工具，
  SQLite FTS5 trigram + L1 查询扩展。
- **feat**: `knowledge_probe` 实验套件（seed/hard/human/contract），后补 variance（10 轮 L1
  门禁）与 latency（4 路并发 p95）套件。
- 阶段 3 门禁：L1 hard 均值 56% PASS、human 65% PASS、p95 延迟 FAIL（如实记录，外部 LLM TTFT）。
