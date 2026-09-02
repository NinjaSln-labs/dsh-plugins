# dsh-subagent-router — agent/request-error 挂载计划

> 状态：待实施 · 日期：2026-08-30 · 目标：监听主代理自身的 LLM 请求失败事件，自动记入 `RouteHealthStore`，使 auto 策略能感知主路由不可用

## 1. 背景与动机

### 问题

当前 `RouteHealthStore` 只记录**子代理委派**的失败（`subagent_model` 工具内部调用 `start()` / `settleForegroundRun()` 时记录）。主代理自身的 LLM 请求失败（如主 agent 调 `ctx.llm.stream()` 遇到 5xx / quota / auth）走的是 agent-loop 的 `agent/request-error` waterfall 事件，从未进入 `RouteHealthStore`。

这意味着：
- 主代理的 provider 路由已不可用（quota 耗尽 / 认证失败），但 `auto` 策略下一次仍然锚定该路由
- 死锚检测只在子代理委派路径上有效，而主代理自己的失败不贡献健康信号
- 设置页健康度标注显示 provider 健康，但实际上主代理已反复失败

### 证据

- 事件目录确认 `agent/request-error` 存在，签名：`(payload: { agent, turn, step, provider: string, failure: LlmFailure, retryPolicy, signal }, next) => Promise<RequestErrorAction>`
- `LlmFailure` 是纯对象（非 Error）：`{ message: string, code: string, status?: number, providerRetryAfterMs?: number }`
- `RequestErrorAction` = `{ kind: 'retry' } | undefined`（`undefined` = 不重试，终态失败）

### 依赖

- `@deepseek-ai/dsh-llm` 的 `LlmFailure` 类型（已引入到 `failure.ts` 的 `CODE_TO_CLASS` 和 `classFromStatus`）
- `RouteHealthStore.record(provider, evidence)` 方法（已存在）

## 2. 架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 监听位置 | `registerModelPickerTools` 中用 `ctx.on(...)` 注册 | 与健康存储生命周期一致，`disposers` 数组统一清理 |
| 事件模式 | waterfall，必须调用 `next()` 并返回其结果 | 不能阻断主代理正常重试流程 |
| 失败分类 | 复用 `extractFailureEvidence()` 接受纯对象的能力 | 已有代码能处理 `{ code, status, message }` 结构 |
| 402 状态码 | 加入 `classFromStatus` → `'quota'` | 402 是业务层配额耗尽，不是网络错误 |
| 作用域传播 | ⚠️ **需验证 scoped 事件传播** | `agent/request-error` 是 `Scoped<Agent>` 事件，`registerModelPickerTools` 中的 `ctx` 可能不在作用域链上 |

## 3. 实施任务

### 3a: 402 状态码分类扩展

- **文件**：`src/failure.ts`
- **改动**：`classFromStatus(402) → 'quota'`

```typescript
function classFromStatus(status: number): FailureClass | undefined {
  if (status === 402) return 'quota'  // 新增：业务层配额耗尽
  if (status === 429) return 'rate-limit'
  if (status === 401 || status === 403) return 'auth'
  if (status >= 500 && status <= 599) return 'server'
  return undefined
}
```

- **验证**：`classifyFailure({ status: 402 })` 返回 `'quota'`；`isTerminalForRoute('quota')` 为 `true`

### 3b: 事件监听注册

- **文件**：`src/tools.ts`（`registerModelPickerTools` 函数内）
- **改动**：在 `disposers.push(...)` 中追加事件监听器

```typescript
// agent/request-error 是 scoped 事件，需从根上下文注册以确保能收到
// 如果不通过 scoped 链传播，改用 ctx.any('agent/request-error', ...)
// 或从 ctx.root 注册
disposers.push(ctx.on('agent/request-error', async (payload, next) => {
  health.record(payload.provider, extractFailureEvidence(payload.failure))
  return next()
}))
```

- `payload.failure` 是 `LlmFailure` 纯对象，`extractFailureEvidence` 已能处理（走 `.code` / `.status` / `.message` 路径，`instanceof LlmError` 不匹配，但纯对象路径覆盖）
- 不阻塞：`next()` 返回 `Promise<RequestErrorAction>`，直接返回其结果
- ⚠️ **实现时需验证：** 如果 `ctx.on('agent/request-error', ...)` 收不到事件（因 scoped 传播限制），改用 `ctx.any()` 或 `ctx.root.on()`

### 3c: 测试

- **文件**：`tests/tools.spec.ts`
- **新增用例**：
  1. 发射 `agent/request-error` 事件（模拟 `LlmFailure` 对象 `{ code: 'QUOTA', status: 402, message: 'quota exhausted' }`），验证 `health.isHealthy(provider)` 变为 `false`
  2. 发射 `agent/request-error` 事件（模拟 `LlmFailure` 对象 `{ code: 'RATE_LIMIT', status: 429 }`），验证 `health.isHealthy(provider)` 变为 `false` 且过期时间合理
  3. 验证 `next()` 被调用，返回值被正确传递
  4. ⚠️ **验证 scoped 事件传播**：模拟 `agent/request-error` 在 scoped 上下文中发射，确认插件能收到
  5. 验证 `agent/request-error` 事件不会影响其他事件监听器

## 4. 验收标准

1. ✅ 单元测试：`classFromStatus(402)` → `'quota'`
2. ✅ 单元测试：`agent/request-error` 事件 → `health.record` 被调用 → `health.isHealthy(provider)` 为 `false`
3. ✅ 单元测试：`next()` 被调用且返回值正确
4. ⚠️ 单元测试：scoped 事件传播通过（若失败则需改为 `ctx.any()` 或 `ctx.root.on()`）
5. ✅ 不对主代理正常重试/错误处理产生副作用
6. ✅ 现有 106 套测试不退化（`pnpm test` 全绿）

## 5. 不做的

- 不在 `agent/request-error` 中触发自动换路（换路是 `auto` 策略的事，事件只负责记录健康信号）
- 不修改 `agent/request-error` 的 `next` 返回值（不干扰重试策略）