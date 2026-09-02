# Weak-Only 灰度运营计划（S3 后续）

> **For agentic workers:** 本计划为「观察 + 评估 + 决策」导向，非纯代码实现。每个任务带精确验证命令与退出标准；用 checkbox（`- [ ]`）跟踪。推荐按序执行，Task 5（灰度评估）是阶段门禁。

**Goal:** 在 weak-only 灰度已上线（PID 37707 运行中）的基础上，完成短期观察纠偏 → 中期灰度周报评估 → 判定是否进入 S4（完整 `mode: on`，需另授权）。

**Architecture:** 数据来源为影子日志 `~/.dsh/slm-shadow/session-slm-shadow.jsonl`（692+ 条、含 `bound` 字段）+ 槽位健康缓存 `~/.dsh/slm-shadow/slot-order-cache.json` + `scripts/shadow_weekly.py` 周报。插件代码在 `48838f6`（51/51 单测）已锁定，本计划默认**不改代码**，除非某观察项发现真实缺陷。

**Tech Stack:** bash + jq/grep（日志探查）、python3（周报 CLI）、git（版本）、dsh web（运行时）。

## Global Constraints

- 唯一工作副本：`/home/shadow/ninjasin-labs/dsh-ecosystem/worktrees/dsh-session-slm-router/dsh-session-slm-router`
- `timeoutMs` 250ms **保持不动**（用户明确裁定，不得调大）
- error 字段隐私红线：不得回传/清理历史日志中的旧格式错误（含原话），仅新日志保持 `predict failed: <简短原因>`
- weak-only 换模是 `agent/request` waterfall 内同步等待预测（≤250ms）——这是授权接受的固有代价
- 本计划的任何「调整」动作（改配置/改代码）都需用户授权后执行，计划本身只观察、评估、报告
- 回滚基线：`cordis.patch.yml` 改 `mode: shadow` → `./scripts/sync-runtime.sh --no-build` → 重启 dsh

---

### Task 1: 短期观察 — error / bad CLI JSON / bound 行为抽查

**Files:**
- Read: `~/.dsh/slm-shadow/session-slm-shadow.jsonl`（尾 100 条）
- Read: `~/.dsh/slm-shadow/slot-order-cache.json`

**Interfaces:**
- 消费：影子日志 v1 事件（字段 `error`、`bound`、`switch`、`actual_provider/model`、`predict_ok`）
- 产出：一份观察结论（无文件产出，记录到 HANDOFF delta）

- [ ] **Step 1: 查 error 非 null 条目（确认隐私格式）**

```bash
grep -o '"error":"[^"]*"' ~/.dsh/slm-shadow/session-slm-shadow.jsonl | grep -v 'error":null' | sort | uniq -c | sort -rn
```

预期：只出现 `predict failed: timeout` / `non-zero exit (N)` / `bad CLI JSON` 等简短原因，**不含**命令、`--utterance` 原文或路径。

- [ ] **Step 2: 查 bad CLI JSON 是否复发**

```bash
grep -c 'bad CLI JSON' ~/.dsh/slm-shadow/session-slm-shadow.jsonl
tail -20 ~/.dsh/slm-shadow/session-slm-shadow.jsonl | grep 'bad CLI JSON'
```

预期：19:38 那条（PID 重启后 turn_seq 1）为唯一或低频；若再次连续出现（≥3 条同段），升级为缺陷调查（Task 4），否则标记「疑似重启抖动，已确认不复发」。

- [ ] **Step 3: 查真实换模（bound:true）与误降级**

```bash
grep -c '"bound":true' ~/.dsh/slm-shadow/session-slm-shadow.jsonl
# 若 >0，列出 bound 的轮次确认目标槽合理
grep '"bound":true' ~/.dsh/slm-shadow/session-slm-shadow.jsonl | tail -5
# 关注「短指令无上下文」风险：switch=switch_to_weak 且 utterance 为 '好/继续/OK' 的轮次
grep 'switch_to_weak' ~/.dsh/slm-shadow/session-slm-shadow.jsonl | tail -10
```

预期：bound:true 出现且目标为 weakSlots 排序首位可用槽；若「好/继续」类短指令触发大量 switch_to_weak，记录为 S2b 风险提醒 1 的候选样本（不一定修，先量化）。

- [ ] **Step 4: 检查槽位缓存健康（dead 分布符合预期）**

```bash
python3 -c "import json;c=json.load(open('$HOME/.dsh/slm-shadow/slot-order-cache.json'));print([ (s['provider']+'/'+s['model'], s['status'], s['source']) for s in c['slots']])"
```

预期：opencode-go-custom 两槽 `dead/provider`（已注销）；其余 ok；无意外 dead。

- [ ] **Step 5: 记录 HANDOFF delta**

在 `HANDOFF.md` 追加一行：观察日期、error 分布、bad CLI JSON 计数、bound 计数、缓存状态。无异常则无需代码改动。

### Task 2: 中期门禁 — 灰度周报评估（一周后，本次灰度的核心决策点）

**Files:**
- Run: `python3 scripts/shadow_weekly.py`（vertical-small-model 库）
- Read: 生成的周报 `reports/b5-dsh-shadow-2026*.md`

**Interfaces:**
- 消费：影子日志全量
- 产出：周报 + 决策结论（维持 / 调整 weakOnlyMainOnly / 放宽 switch_to_strong / 进入 S4）

- [ ] **Step 1: 跑灰度周报**

```bash
cd /home/shadow/ninjasin-labs/vertical-small-model
python3 scripts/shadow_weekly.py
```

预期：正常输出周报，含「would_bind → bound 灰度命中率」指标（新指标，S3 引入）。

- [ ] **Step 2: 提取核心指标**

```bash
# 命中率：bound:true / would_bind:true
grep -c '"would_bind":true' ~/.dsh/slm-shadow/session-slm-shadow.jsonl
grep -c '"bound":true' ~/.dsh/slm-shadow/session-slm-shadow.jsonl
# 分类精度（A 层）：suggested=weak 且 actual=strong 的 switch_to_weak 占比
grep -c '"switch":"switch_to_weak"' ~/.dsh/slm-shadow/session-slm-shadow.jsonl
# 升档拦截（B 层）：switch_to_strong 记录但 bound=false
grep -c '"switch":"switch_to_strong"' ~/.dsh/slm-shadow/session-slm-shadow.jsonl
```

- [ ] **Step 3: 对照 S2b 裁定 §3 决策**

给出三条结论（各一句话 + 证据数字）：
1. **维持 weak-only？**（A 层 precision 基线 93%，看灰度期是否有显著偏差）
2. **是否放宽 switch_to_strong？**（B 层 38% 过敏——评估过敏率在灰度期是否下降；这是 S4 的前置问题）
3. **weakOnlyMainOnly 是否调整？**（子代理误降级风险 vs 主会话覆盖率）

- [ ] **Step 4: 成本收益对比**

用影子日志估算：降档轮 vs 未降档轮的 token 消耗差（若无 token 数据，退化为「bound 轮次 vs 总轮次占比」作为代理指标）。

- [ ] **Step 5: 提交决策结论**

在 `HANDOFF.md` 记录决策；若决策为「进入 S4」→ 另开计划（S4 需用户单独授权）。

### Task 3: 长期展望 — S4（完整 `mode: on`）前置清单

**Files:**
- Read: `/home/shadow/ninjasin-labs/vertical-small-model/plans/plan-b5-dsh.md` §5 Phase S3「生效 mode: on（另授权）」

**Interfaces:**
- 消费：Task 2 决策
- 产出：S4 是否启动的结论 + 前置条件核对

- [ ] **Step 1: 核对 S4 前置条件**

- [ ] S2b 裁定 §3 的灰度命中率达标（由 Task 2 判定）
- [ ] 「上下文继承 / 表单任务分离」设计裁决完成（HANDOFF 未完成边界，由设计方裁决）
- [ ] switch_to_strong 放行策略确定（B 层过敏治理方案）
- [ ] 用户对 `mode: on` 单独授权（plan-b5 明确「另授权」）

- [ ] **Step 2: 结论落盘**

达标 → 新建 S4 计划（writing-plans）；未达标 → 记录阻塞原因，维持 weak-only。

### Task 4: 应急分支 — 观察期发现缺陷才执行（默认跳过）

**Files:**
- Modify: `dsh-session-slm-router/src/*`（仅当 Task 1/2 发现真实缺陷）

**Interfaces:**
- 消费：Task 1 Step 2 升级信号
- 产出：修复提交 + 单测（51/51 基线之上新增）

- [ ] **Step 1: 复现与根因**（systematic-debugging：先复现，不猜）
- [ ] **Step 2: 修复 + 回归测试**（沿用现有测试文件 `tests/router.test.mjs`）
- [ ] **Step 3: 构建 + 全量单测 + sync-runtime + 提交**

```bash
npx tsc -p tsconfig.build.json && npm test && ./scripts/sync-runtime.sh
```

预期：单测 ≥51 全过，提交信息符合 Conventional Commits。

### Task 5: 阶段门禁汇总

- [ ] 1. 短期观察（Task 1）全部 Step 有结论
- [ ] 2. 灰度周报（Task 2）产出三条决策
- [ ] 3. S4 前置核对（Task 3）有结论
- [ ] 4. 缺陷分支（Task 4）未触发或已闭环
- [ ] 5. HANDOFF.md 已记录全部 delta

**退出标准：** 灰度评估结论明确（维持/调整/进 S4），HANDOFF 最新，工作树干净，无未决缺陷。

---

## Self-Review（已执行）

- **Spec 覆盖**：HANDOFF 立即待办 4（error 抽查）/5（bad CLI JSON）/6（一周后周报）→ Task 1/2；未完成边界「上下文继承/表单任务分离」→ Task 3；回滚基线 → Global Constraints。✅
- **占位符扫描**：无 TBD/「写测试」类空指令；每个 Step 有精确命令或产出。✅
- **命令一致性**：日志路径、字段名（`bound`/`switch`/`would_bind`）与影子日志 schema、shadow_weekly 指标一致。✅
