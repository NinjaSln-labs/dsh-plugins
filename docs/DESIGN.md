# dsh-subagent-cursor — Design

Status: Sprint 0 landed  
Version: 0.1.0（可委派 one-shot provider；未 npm publish）

## Problem

DSH 父代理需要把仓库内编码任务委派给 **Cursor 子代理**。官方已有 `codex` / `claude-code` / `acp`；缺少 Cursor。

## Decision: path B

专用 Profile Bundle `dsh-subagent-cursor`，注册 `ctx.subagents` provider（默认 `cursor`），经 `dsh-tool-subagent` 暴露工具。

## Domain boundary

| 概念 | 含义 |
|---|---|
| 委派 | 父代理提交自包含文本任务 |
| Cursor 子代理 | 父 session `cwd` 上的 one-shot local Cursor agent |
| 结果 | summary 优先展示的最终文本 |
| 交接质量 | provider SLA |
| 执行到位 / 正确性 | 父代理 / 验收门，非本包 SLA |

`inheritsParentContext: false`。不宣称 start-time capabilities。

## Runtime (MVP)

`@cursor/sdk` local；`Agent.create` + `send` + `wait`（可 cancel）。鉴权：`config.env.CURSOR_API_KEY`。

## Sprint 0 落地

| 步骤 | 行为 |
|---|---|
| cwd | `resolveChildCwd('dsh-subagent-cursor', configured?, parent.session.header.cwd)` |
| create | 可注入 `createSdkAgent` → 默认 `Agent.create({ apiKey, model: { id }, local: { cwd } })` |
| send | 用户文本 + `wrapTaskPrompt` footer → `agent.send` |
| settle | `handle.wait()` 与 `signal` abort race；abort → `cancel`（若支持） |
| map | 见下表 |
| publish | `settleRunResult` + `subprocessRunHandle`；`dispose` 幂等 |

### 结果映射

| SDK `RunResult.status` | `SubagentResult.stopReason` | 父可见 output |
|---|---|---|
| `finished` | `completed` | `formatForParent(parseResultText(result))` |
| `cancelled` | `aborted` | `cursor:query-run/cancelled[; run=…]` |
| `error` / wait 抛错 | `error` | `cursor:<stage>/<category>` 行 + 短详情（无密钥） |

### 配置字段

| 字段 | 默认 | 说明 |
|---|---|---|
| `providerName` | `cursor` | `ctx.subagents` 注册名 |
| `model` | `composer-2.5` | SDK model id |
| `env.CURSOR_API_KEY` | （空） | 缺则 `start` 在 publication 前 reject（`query-start/auth`） |
| `disposeGraceMs` | `3000` | 保留的 teardown 时序参数（正有限数） |

## Result format

软契约 + 展示硬规则（summary 外露，body 折叠）。缺标签不 fail seam。

## Quality split

Provider = 交接可靠。父代理 = 「起码做了」。更外层 = 做对。
