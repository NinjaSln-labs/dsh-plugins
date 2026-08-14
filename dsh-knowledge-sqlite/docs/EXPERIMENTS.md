# 实验与验证证据（EXPERIMENTS）

> dsh-knowledge-sqlite 的检索质量证据链：基准实验（RESULTS-v3）→ 动态原型验证 →
> 宿主 e2e（bundle 真实加载）。全部脚本与数据集可复现。

## 1. 基准实验（RESULTS-v3，2026-08-14）

语料：12 条真记忆（m1-m12，富化）+ 10 条提炼记忆（n1-n10）+ 500 条 DSH 仓库真实文档段落干扰项。

### 1.1 方差（门禁 1：≥10 次运行，LLM 难查询集 14 条 × 12 条语料）

| 臂 | recall@1 均值 | 范围 |
|---|---|---|
| C 查询扩展-only（L1） | **35.7%** | 29–43% |
| D 富化+扩展（L1+L2） | **63.6%** | 50–79% |

### 1.2 大语料（512 条：12 记忆 + 500 干扰项）

**LLM 难查询集（14 条）**：

| 臂 | recall@1 | recall@3 | MRR | precision@5 | NDCG@5 |
|---|---|---|---|---|---|
| A 纯词法 | 7% | 7% | 0.071 | 0.014 | 0.071 |
| B 写入富化 | 21% | 29% | 0.268 | 0.071 | 0.290 |
| C 查询扩展 | 21% | 29% | 0.264 | 0.071 | 0.287 |
| D 富化+扩展 | **50%** | **71%** | **0.607** | 0.143 | 0.635 |
| E PRF | 7% | **36%** | 0.202 | 0.071 | 0.242 |

**reasoner 交叉查询集（12 条）**：A 75% → D 100%。

### 1.3 人类查询集（20 条真实用户消息，17 条有目标，user-verified；522 条语料）

| 臂 | recall@1 | MRR |
|---|---|---|
| A 纯词法 | 65%（11/17） | 0.703 |
| C 查询扩展 | **82%**（14/17） | 0.853 |
| D 富化+扩展 | **88%**（15/17） | 0.882 |

none 查询（3 条）top1 全为空/干扰项——无误报。

### 1.4 修正后的召回全景

| 场景 | A 纯词法 | C 扩展 | D 富化+扩展 |
|---|---|---|---|
| LLM 难查询 × 12 条 | 7% | 36% | 64% |
| LLM 难查询 × 512 条 | 7% | 21% | 50% |
| reasoner × 512 条 | 75% | 92%* | 100% |
| 人类查询 × 522 条 | 65% | 82% | 88% |

（*reasoner × 12 条语料测得 92%）

## 2. 动态原型验证（kpro-2，2026-08-14）

沙箱内无法跑 node:sqlite → 三件套分层验证（详见 `research/prototype/RESULTS-PROTOTYPE.md`）：

1. **SQLite 存储层**（`prototype/sqlite-trigram-verify.mjs`，真实 node:sqlite + FTS5 trigram）：
   精确复现 A 7% / C 21% / D 50% / human-A 65%（逐查询 rank 一致）
2. **JS BM25 校准**（`prototype/js-bm25-calibration.mjs`）：与 FTS5 bm25 **0/72 处 rank 不一致**
3. **动态插件链路**：write→trigram→search（L0 + L1-live 真实 llm.stream）；
   hard L1-live 43%/64%（≥30% 验收线）、human 65%（≥50%）、contract 11/11、ask 门控拒绝

关键发现（已并入 bundle 实现）：
- `maxQueryTrigrams` 顺序截断丢失长查询判别词（human A 65%→41%）→ 生产用 idf 优先截断或不限
- `llm.stream` 消息必须用 content blocks + source + id；finish reason 是对象
- workspace 身份优先调用方 cwd（`session.header.cwd`）
- 评估目标按 dedupeKey→id 映射解析（确定性 id 是 `k-<hash>` 前缀）

## 3. 宿主 e2e（bundle 真实加载，2026-08-14）

dsh-knowledge-sqlite 作为 profile bundle 挂载到 `dsh web`（`~/.dsh/profiles/web`）后的验证：

| 验证项 | 结果 |
|---|---|
| 工具注册 | knowledge_write/update/search/list/delete/probe ✓ |
| hard 确定性臂 | A 7% / C 21% / D 50%（真实 SQLite，逐查询 rank 一致）✓ |
| hard L1-live（实时扩展） | **64%**（9/14）✓（≥30% 验收线） |
| human A / L1-live | 65% / 65% ✓（≥50% 验收线） |
| contract | 12/12 ✓ |
| ask 门控 | knowledge_write 在 approval=never 下拒绝 ✓ |
| 扩展实测 | 31 次真实调用，26 成功（84%），5 超时降级（2.5s 超时），缓存生效 |

挂载排障记录（社区插件加载的坑：internal loader 依赖 + default export 必须是插件对象）：
`research/prototype/MOUNTING-NOTES.md`。

## 4. 复现

```sh
# 基准实验（memory-experiment 目录）
node eval.mjs            # 五臂 × 12 条（LLM 难查询）
node scale-eval.mjs      # 四臂 × 512 条 + PRF
node variance.mjs        # 10 次方差（需要 API key）
node human-eval.mjs      # 人类查询评估（22 记忆 + 500 干扰项）

# 原型验证（research/prototype 目录）
node sqlite-trigram-verify.mjs   # SQLite 层基线（无 API 依赖）
node js-bm25-calibration.mjs     # JS↔FTS5 校准（无 API 依赖）

# bundle（dsh-plugins/dsh-knowledge-sqlite）
npm test                 # vitest 29 项（store 16 + service 13）
node test-smoke.mjs      # SQLite 冒烟（7/21/50/65 + 契约）
# 宿主：knowledge_probe { suite: 'variance' | 'latency' | 'all' }
```

## 5. 验收门禁对照（阶段 3 状态）

| 门禁（V1.11） | 目标 | 状态 |
|---|---|---|
| L1 recall@1（hard） | ≥30% 均值，无单次 <20% | 原型 43/64%；宿主 64%；**10 轮方差待跑** |
| human 集 L1 | ≥50% | 宿主 65% ✓ |
| 人类集 precision@1 | ≥80%（信息性） | 待 promotion 补测 |
| p95 L1 延迟 | ≤2.0s（4 路并发） | **待跑**（latency suite 就绪） |
| 写入即检索（零 LLM） | AC | ✓ |
| 授权/打标/错误码/事件 | AC | contract 12/12 ✓ |
| 实验套件入库 | AC | ✓ |
