# dsh-subagent-router — auto 策略优先付费版计划

> 状态：待实施 · 日期：2026-08-30 · 目标：修复 `model: "auto"` 策略在免费版模型可用时错误地优先选择免费版的问题

## 1. 背景与动机

### 问题

从反馈 `subagent-402-failure-2026-08-30.md` 的根因分析：

```
父模型: cline-pass/deepseek-v4-flash
auto 策略选中 provider: teamorouter
teamorouter 有 deepseek-v4-flash（付费）和 deepseek-v4-flash-free（免费）
auto 策略的 heuristic 选中了 deepseek-v4-flash-free（免费版）
```

根本原因有两个：

**原因 A（主要）：模型级锚缺失。** `anchorUsable` 的判断条件为：
```typescript
const anchorUsable = anchorCandidate !== undefined
  && parentProvider !== undefined
  && parentProvider === effectiveProvider  // ← 这里
  && health.isHealthy(effectiveProvider)
```
父 provider 是 `cline-pass`，有效 provider 是 `teamorouter`，`parentProvider !== effectiveProvider` → 锚不生效。但父模型 `deepseek-v4-flash` 在 `teamorouter` 的目录中**实际存在**，只是不在同一个 provider 上。

**原因 B（辅助）：`-free` 后缀无惩罚。** `modelScore` 中 `deepseek-v4-flash` 和 `deepseek-v4-flash-free` 都匹配 `flash`（LIGHT_MODEL），得分均为 **-1**（审计纠正：计划最初声称得分为 1 和 0，实际 `deepseek` 不匹配 `\bdeep\b`，`seek` 是单词字符使 `\b` 不匹配）。两者得分相同，`standard` 档 heuristic 无法区分，按目录顺序选了免费版。

### 实际得分验证（审计修正）

| 模型 | STRONG 匹配 | LIGHT 匹配 | 得分 | 说明 |
|------|-----------|-----------|------|------|
| `deepseek-v4-flash` | ❌ `deepseek` 不匹配 `\bdeep\b` | ✅ `flash` 匹配 | **-1** | 计划最初声称 1，实际是 -1 |
| `deepseek-v4-flash-free` | ❌ | ✅ `flash` 匹配 | **-1** | 计划最初声称 0，实际是 -1 |
| `deepseek-v4-std` | ❌ | ❌ | **0** | 平衡模型 |
| `deepseek-v4-pro` | ✅ `pro` 匹配 | ❌ | **1** | 强模型 |

### 风险

- 免费版有配额限制，**必然在密集调用中耗尽**（反馈中 25 轮 web_search 即耗尽）
- 用户被迫手动指定 `subagent_model provider: commandcode model: deepseek-v4-flash` 来规避
- 当前行为是**成本优先而非任务优先**，违背 ROADMAP "不替用户省钱作为唯一目标" 原则

## 2. 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 模型级锚 | **主要修复**：在 heuristic 层增加模型级锚检查 | 直接解决跨 provider 锚定问题，父模型在有效 provider 目录中可用时直接使用 |
| `-free` 惩罚 | **辅助修复**：`modelScore` 中降 `-free` 模型 1 分 | 在 trivial/complex 档有效，standard 档需配合 `pickModel` 修改 |
| `standard` 档 `pickModel` 回退 | 改为 `find(score===0) ?? sort(score desc)[0]` | 解决 `-free` 惩罚在 standard 档无效问题（当前 `scored[0]` 按目录顺序，可能仍选免费版） |

### 审计修复说明

**审计发现的问题**（已在本计划中修正）：
1. `deepseek-v4-flash` 实际得分 -1，不是 1。`\bdeep\b` 不匹配 `deepseek`（`seek` 是单词字符，`\b` 不在 "deep" 和 "seek" 之间）。
2. `-free` 惩罚在 standard 档无效，因为 `pickModel` 的 `find(score===0) ?? scored[0]` 中，两者都不等于 0 时回退到 `scored[0]`（目录顺序），免费版仍可能被选中。
3. 需配合修改 `standard` 档的 `pickModel` 回退策略。

## 3. 实施任务

### 3a: 模型级锚（model-level anchor）— 主要修复

- **文件**：`src/tools.ts`（`resolveAutoSelection` 函数）
- **改动**：在 heuristic 层（Layer 3）增加模型级检查

在 `models = await llm.listModels(effectiveProvider)` 之后、`pickModel` 之前，检查父模型 id 是否在有效 provider 的目录中：

```typescript
// 模型级锚：父模型 id 在有效 provider 目录中存在时，即使 anchorUsable 为 false 也可使用
const modelOnProvider = anchorCandidate !== undefined
  && models.some(m => m.id === anchorCandidate)

// 在 heuristic 层（Layer 3）中，pick === undefined 分支
if (pick === undefined) {
  policyUsed = 'heuristic'
  if (effectiveAnchor !== undefined && (tier !== 'complex' || effectiveAnchorScore! >= 1)) {
    pick = { id: effectiveAnchor, score: effectiveAnchorScore! }
    anchored = true
  } else if (modelOnProvider && (tier !== 'complex' || modelScore(anchorCandidate!) >= 1)) {
    // 模型级锚：父模型在同一 provider 上可用
    pick = { id: anchorCandidate!, score: modelScore(anchorCandidate!) }
    anchored = true
  } else {
    pick = pickModel(models, tier)
  }
}
```

**注意**：`anchorCandidate` 是 `parentModel`（父模型 id），不依赖 `parentProvider`。只要该模型 id 在有效 provider 的目录中存在，即可锚定。

### 3b: `-free` 后缀惩罚 + standard 档 `pickModel` 回退修正

- **文件**：`src/tools.ts`
- **改动 1**：`modelScore` 函数增加 `-free` 后缀惩罚

```typescript
function modelScore(id: string): number {
  let score = 0
  if (STRONG_MODEL.test(id)) score += 1
  if (LIGHT_MODEL.test(id)) score -= 1
  // 免费版模型有配额限制，auto 应优先付费版
  // 当仅有免费版可用时，仍能选中（score 低但仍是正数或零）
  if (/\b-free\b/i.test(id)) score -= 1
  return score
}
```

- **改动 2**：`standard` 档 `pickModel` 回退改为按得分降序

```typescript
// standard 档：优先选平衡模型（score=0），无则选得分最高的
case 'standard': {
  const balanced = scored.find(entry => entry.score === 0)
  if (balanced !== undefined) return balanced
  // 没有平衡模型时，选得分最高的（而非目录顺序第一个）
  const max = Math.max(...scored.map(entry => entry.score))
  return scored.find(entry => entry.score === max)
}
```

**影响矩阵**（修复后，`-free` 惩罚 + standard 回退修正）：

| 情形 | 当前 | 修复后 |
|------|------|--------|
| `deepseek-v4-flash`(-1) vs `deepseek-v4-flash-free`(-2) 同时存在 | 选免费版（目录顺序） | 选付费版（模型级锚优先，且 `-free` 惩罚 + standard 最高分回退） |
| 仅 `deepseek-v4-flash-free` 可用 | 选免费版 | 仍选免费版（唯一选择） |
| 父模型锚定 `deepseek-v4-flash-free` | 锚定免费版 | 仍锚定免费版（父模型明确选中） |
| `v4-pro-free` vs `v4-pro` | 选免费版 | 选付费版 |

### 3c: 测试

- **文件**：`tests/tools.spec.ts`
- **新增用例**：
  1. 父模型 `deepseek-v4-flash`，provider 切换为 `teamorouter`，`teamorouter` 目录有 `deepseek-v4-flash` 和 `deepseek-v4-flash-free` → `auto` 选中 `deepseek-v4-flash`（模型级锚）
  2. `modelScore('deepseek-v4-flash-free')` → -2
  3. `modelScore('deepseek-v4-flash')` → -1
  4. 仅 `deepseek-v4-flash-free` 可用 → 仍能选中（不阻塞）
  5. 父模型明确锚定 `deepseek-v4-flash-free` → 仍锚定免费版（不违反用户意图）
  6. `standard` 档 `pickModel` 回退：所有模型得分均为负时，选得分最高的（而非目录顺序第一个）

## 4. 验收标准

1. ✅ 单元测试：`modelScore('deepseek-v4-flash-free')` 返回 -2
2. ✅ 单元测试：`modelScore('deepseek-v4-flash')` 返回 -1
3. ✅ 单元测试：父模型 `deepseek-v4-flash` 在有效 provider 目录中存在 → `auto` 选中该父模型（模型级锚）
4. ✅ 单元测试：仅 `-free` 模型可用时，auto 策略仍能选中它（不阻塞）
5. ✅ 单元测试：`standard` 档 `pickModel` 回退选最高分
6. ✅ 现有 106 套测试不退化（`pnpm test` 全绿）

## 5. 不做的

- 不引入 `free` 配置项（如 `preferPaid: boolean`）——当前行为是策略默认值，用户想显式选免费版可用 `model: 'deepseek-v4-flash-free'` 显式指定
- 不修改 `autoTierPicks` / `autoTierPolicy` 的语义
- 不改变 `LIGHT_MODEL` 正则（`-free` 独立惩罚，不混入 `flash`/`lite` 等性能信号）