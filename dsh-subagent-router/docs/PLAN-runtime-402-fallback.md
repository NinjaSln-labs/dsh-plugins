# dsh-subagent-router — 运行时 402 业务错误 → fallback 换路计划

> 状态：待实施 · 日期：2026-08-30 · 目标：子代理运行时返回 402 配额耗尽等业务错误时，`subagent-router` 正确分类为终态 `quota`，触发 `autoReroute` 换路到健康 provider

## 1. 背景与动机

### 问题

从反馈 `subagent-402-failure-2026-08-30.md` 的完整链路：

```
子代理启动 → 多轮 web_search → 免费配额耗尽 → adapter 返回 402
→ 子代理 seam 压缩为 SubagentResult { stopReason: 'error', diagnostic: '402: ...' }
→ settleForegroundRun 中 stopReason === 'error' 分支硬编码为 health.record('other')
→ autoReroute 不触发（只有 quota/auth 才触发换路）
→ 子代理保持失败状态，不尝试换路到其他 provider
```

**关键问题**：`SubagentResult.diagnostic` 字段携带了原始错误信息（`402: {"message":"您的deepseek-v4-flash免费额度已耗尽"}`），但 `settleForegroundRun` 的 `stopReason === 'error'` 分支未检查 `diagnostic`，直接硬编码为 `'other'`。

### 与 B3 盲区的关系

ROADMAP B3 记录的是"子代理运行时 quota 盲区"——`dsh-subagent` 把运行时失败压成 `stopReason: 'error'`，底层 `LlmFailure` 不跨进程传回。但 `SubagentResult.diagnostic` 字段**是** provider-authored 的诊断文本，包含 `free_request_quota_exhausted` 等信号。

### 依赖

- `SubagentResult.diagnostic` 字段（`string | undefined`，provider-authored，≤4096 bytes）
- `isQuotaExceededError()` 和 `isModelNotFoundError()` 文本分类器（已在 `failure.ts` 中从 `@deepseek-ai/dsh-llm` 引入）

### ⚠️ 审计发现：`isQuotaExceededError` 无法识别中文 402 消息

`isQuotaExceededError` 的匹配模式是英文正则，对实际 402 消息的验证结果：

| 测试文本 | 是否匹配 | 原因 |
|---------|---------|------|
| `"quota exhausted"` | ✅ | 标准英文模式 |
| `"quota_exhausted"` | ✅ | snake_case 模式 |
| `"free_request_quota_exhausted"`（实际 type 字段） | ❌ | `\b` 在 `_q` 之间不匹配 |
| `"您的deepseek-v4-flash免费额度已耗尽"`（中文消息） | ❌ | 无中文模式 |

**结论**：仅靠 `isQuotaExceededError` 无法识别这份反馈的真实 402 中文消息。`extractFailureEvidenceFromResult` 必须额外增加中文 quota 检测和 `quota_exhausted` 子串匹配。

## 2. 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 检查来源 | `result.diagnostic` 优先 + `result.output` 文本辅助 | `diagnostic` 是专门的非助手失败文本；`output` 可能包含消费者消息 |
| 分类方法 | 复用 `isQuotaExceededError` + `isModelNotFoundError` + **中文 quota 检测** + **`quota_exhausted` 子串匹配** | 覆盖英文/中文/JSON 三种消息格式 |
| 中文 quota 检测 | `/免费额度已耗尽/` 子串匹配 | 直接匹配实际 402 消息中的中文短语 |
| `quota_exhausted` 子串 | `/quota_exhausted/i` 无 `\b` 限制 | 匹配 snake_case 类型字段 |
| 默认行为 | `diagnostic` 为空时退化到 `'other'` | 向后兼容，不做推测性分类 |
| 是否影响 `autoReroute` | 是——`quota` 分类直接触发 `autoReroute` | 已有 `rerouteToHealthy` 实现，只缺正确分类 |

## 3. 实施任务

### 3a: 新增 `extractFailureEvidenceFromResult` 辅助函数

- **文件**：`src/failure.ts`
- **新增**：

```typescript
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/**
 * 从 SubagentResult 的 diagnostic 和 output 文本中提取失败证据。
 * 主要用于 stopReason === 'error' 时，检查 diagnostic 字段是否包含
 * quota / model-not-found 等信号，这些信号被 seam 压缩后丢失了
 * 结构化 LlmFailure。
 *
 * 覆盖三种消息格式：
 * 1. 英文模式：isQuotaExceededError（标准 quota/credit/balance 表述）
 * 2. 中文模式：/免费额度已耗尽/（实际 402 中文消息）
 * 3. 类型字段：/quota_exhausted/（snake_case，无 \b 限制）
 */
export function extractFailureEvidenceFromResult(
  diagnostic: string | undefined,
  output: readonly ContentBlock[],
): FailureEvidence {
  const outputText = output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
  const combined = `${diagnostic ?? ''}\n${outputText}`

  // 分层检测：中文 quota → 英文 quota → model-not-found → 默认退化
  if (/免费额度已耗尽/.test(combined)) return { cls: 'quota' }
  if (/quota_exhausted/i.test(combined)) return { cls: 'quota' }
  if (isQuotaExceededError(combined)) return { cls: 'quota' }
  if (isModelNotFoundError(combined)) return { cls: 'other', modelNotFound: true }
  // 默认退化——瞬态，与现有行为一致
  return { cls: 'other' }
}
```

**检测优先级**：中文 quota → snake_case quota → 英文 quota → model-not-found → other。先检测中文和 snake_case 是因为它们比 `isQuotaExceededError` 的 `\b` 正则更快且更鲁棒。

### 3b: 修改 `settleForegroundRun` 中的 `stopReason === 'error'` 分支

- **文件**：`src/tools.ts`（`settleForegroundRun` 函数）
- **改动**：

```typescript
// 当前代码（L582-584）：
if (error !== undefined) {
  health?.record(provider, 'other')
  throw new Error(withPartialText(error, result.output))
}

// 修改为：
if (error !== undefined) {
  // 从 result.diagnostic 和 output 中提取失败证据
  // diagnostic 可能包含 402/quota 等业务层错误信号
  const evidence = extractFailureEvidenceFromResult(result.diagnostic, result.output)
  health?.record(provider, evidence)
  throw new Error(withPartialText(error, result.output), { cause: evidence })
}
```

### 3c: 导入新增函数

- **文件**：`src/tools.ts` 顶部
- **改动**：在 `import { ... } from './failure.ts'` 中增加 `extractFailureEvidenceFromResult`

### 3d: 测试

- **文件**：`tests/failure-evidence.spec.ts`（新增 `extractFailureEvidenceFromResult` 用例）
- **新增用例**：
  1. `diagnostic = '402: {"message":"您的deepseek-v4-flash免费额度已耗尽"}'` → `{ cls: 'quota' }`（中文模式）
  2. `diagnostic = 'free_request_quota_exhausted'` → `{ cls: 'quota' }`（snake_case 类型字段）
  3. `diagnostic = 'quota exhausted'` → `{ cls: 'quota' }`（英文模式）
  4. `diagnostic = 'model not found: deepseek-v4-flash'` → `{ cls: 'other', modelNotFound: true }`
  5. `diagnostic = ''` → `{ cls: 'other' }`（退化行为不变）
  6. `diagnostic = 'API rate limit exceeded'` → `{ cls: 'other' }`（文本分类器不匹配，正确退化）
  7. `diagnostic = undefined` + `output = [{ type: 'text', text: 'quota exhausted' }]` → `{ cls: 'quota' }`（output 辅助检查）

## 4. 验收标准

1. ✅ `extractFailureEvidenceFromResult` 单元测试：`diagnostic` 含中文 `免费额度已耗尽` → `{ cls: 'quota' }`
2. ✅ `extractFailureEvidenceFromResult` 单元测试：`diagnostic` 含 `quota_exhausted` → `{ cls: 'quota' }`
3. ✅ `extractFailureEvidenceFromResult` 单元测试：`diagnostic` 为空 → `{ cls: 'other' }`（退化行为不变）
4. ✅ `extractFailureEvidenceFromResult` 单元测试：`diagnostic` 含 model-not-found 信号 → `{ cls: 'other', modelNotFound: true }`
5. ✅ 集成测试（`tools.spec.ts`）：`SubagentResult { stopReason: 'error', diagnostic: '402: 免费额度已耗尽' }` 在 `settleForegroundRun` 中 → `health.record` 被调用为 `'quota'` 而非 `'other'`
6. ✅ `autoReroute` 在 `quota` 分类下正确触发换路（已有 `rerouteToHealthy` 测试覆盖，只需确认 `extractFailureEvidence` 返回 `{ cls: 'quota' }` 时 `autoReroute` 触发）
7. ✅ 现有 106 套测试不退化（`pnpm test` 全绿）

## 5. 不做的

- 不修改 `SubagentResult` 接口（只读其 `diagnostic` 字段）
- 不引入 `diagnostic` 的结构化解析（依赖文本分类器，不假设 JSON 格式）
- 不修改 `isQuotaExceededError` 的行为（只是在其基础上补充中文和 snake_case 模式）
- 不修改 `runForegroundWithRecovery` 中的 `autoReroute` 逻辑（已有正确实现，只是缺正确分类输入）