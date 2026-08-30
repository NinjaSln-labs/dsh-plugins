# Sprint 0 — Cursor Subagent Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans (or subagent-driven-development) task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 让 DSH 能通过 `ctx.subagents` 上的 `cursor` provider 发起一次本机 Cursor one-shot 委派，并把 summary-first 结果交回父代理。

**Architecture:** Profile Bundle 注册 `SubagentProvider`；`start()` 解析父 session cwd → `@cursor/sdk` `Agent.create` + `send` + `wait` → 将 `RunResult` 映射为 seam 的 `SubagentRun`（可 cancel / dispose）。结果文本经软契约解析后以 summary 外露、body 折叠形式写入 `output`。本迭代不挂 client half、不保证「任务做完」。

**Tech Stack:** TypeScript ESM、`@cursor/sdk@1.0.28`、`@deepseek-ai/dsh-subagent`（`resolveChildCwd` / `settleRunResult` / `subprocessRunHandle` 或等价自管 handle）、vitest、cordis Profile Bundle。

**流程依据:** 仓库根 [`DEVELOPMENT.md`](../../../DEVELOPMENT.md)（Backlog → Sprint → DoD → 交付 → 回顾）。本包是 **Host-only Profile Bundle**（同 Claude Code / Codex），动态插件的 client-half / 沙箱全局禁用条目对本迭代 **不适用**；DoD 用下方「适配版」。

## Global Constraints

- peer：`@deepseek-ai/dsh-subagent` 等与 `package.json` 一致；依赖 pin `@cursor/sdk@1.0.28`
- provider 名默认 `cursor`；`inheritsParentContext: false`；capabilities 全 `false`
- 只做 local one-shot；不做 ACP / cloud / continuable
- `result` 在 publication 后 **永不 reject**（失败 → `stopReason: 'error'|'aborted'`）
- 父可见文本：summary 优先；body 进 `<details>`；缺标签不 fail seam
- 不把「Cursor 做对 / 做完」写进 provider SLA
- 每迭代只取 1–2 条 Backlog；本 Sprint = Sprint 0 两条故事

---

## Backlog（体验导向）

| ID | 故事 | 优先级 |
|---|---|---|
| **B1** | 作为 DSH 父代理，我想用 `subagent_cursor`（经 tool-subagent 绑 `cursor`）把任务交给本机 Cursor，以便借用 Cursor 的编码工具链 | P0 |
| **B2** | 作为使用父代理的人，我想先看到一句 summary、详情可折叠，以便不看长日志也能判断结果 | P0 |
| B3 | 作为开发者，我想在无 Key 的 CI 上用 fake SDK 跑契约测，以便不依赖真 Cursor | P0（随 B1） |
| B4 | 作为运维，我想取消中的委派能停下且不留僵尸，以便会话可回收 | P1（本 Sprint 做最小 cancel） |
| B5 | 作为用户，我想装包后 README 能复制配置启用，以便立刻试用 | P1（本 Sprint 文档最小；完整安装说明可顺延 Phase 1） |
| B6 | 作为编排者，我想有验收探针保证「起码做了」 | P2（明确不在本 Sprint） |

**本 Sprint 取：B1 + B2**（B3/B4 作为 B1 的必要验收一并完成）。

---

## Sprint 0 — 设计决策（轻量）

| 题 | 决策 |
|---|---|
| 平台边界 | **仅 host**：注册 `SubagentProvider`；工具行由 profile 的 `dsh-tool-subagent` 提供；无 client 包 |
| SDK API | 用 `Agent.create` + `send` + `wait`（可 `cancel`）；不用 `Agent.prompt`（难接 AbortSignal） |
| cwd | `resolveChildCwd('dsh-subagent-cursor', configured?, parent.session.header.cwd)`；禁止回落到进程 cwd |
| 鉴权 | `apiKey` 来自 `config.env.CURSOR_API_KEY`（缺则 start 前 reject，归 `query-start/auth`） |
| 结果 | `RunResult.status === 'finished'` → `completed` + `formatForParent(parseResultText(result))`；`cancelled` → `aborted`；其余 → `error` + diagnostic 行进 output 文本前缀 |
| 任务包装 | 在用户 prompt 外包裹固定 footer，要求 `<summary>/<status>/<body>`；软解析 |
| 生命周期 | publication 前失败 → `start` reject 并 dispose agent；之后失败只进 `result`；`dispose` 幂等：cancel + `agent[Symbol.asyncDispose]()` |
| 边界 | 空 prompt → start reject；signal 已 aborted → start reject；并发多 start 彼此独立 |

### 适配版 DoD（本 Sprint 全绿才 Done）

**功能**

- [x] 用 fake SDK：成功委派返回 summary-first 文本、`stopReason: completed`
- [x] 取消：`signal.abort` → `aborted`，dispose 后无未处理 rejection
- [x] SDK/run error → `error`，output 含 `cursor:<stage>/<category>` 行
- [x] 无 cwd / 无 API key → `start` reject（publication 前）

**质量（Host Bundle）**

- [x] `pnpm test` 全绿；`pnpm run build` 产出 `lib/`
- [x] 无猜测 API：只用 `@cursor/sdk` 与 `dsh-subagent` 公开类型
- [x] dispose 幂等；测试断言双重 dispose 不抛
- [x] diagnostic / 错误文本不包含 `CURSOR_API_KEY` 字面值或密钥形态

**文档**

- [x] `docs/DESIGN.md` 补「Sprint 0 落地」一小节
- [x] `CHANGELOG.md` 一行（0.0.1 或 0.1.0-dev）
- [x] `README.zh.md` 最小启用片段（tool 行 + env）
- [x] 回顾三问写入 CHANGELOG 或 `docs/pits.md`（若有新坑）

**交付试用（有 Key 时可选）**

```text
在已挂 tool-subagent-cursor 的会话里：
用 subagent_cursor 只读报告当前目录 package.json 的 name 字段，按 summary/status/body 格式回复。
```

无 Key：以 fake SDK 单测为验收；credentialed 冒烟标为 Phase 1。

---

## File map（本 Sprint）

| 文件 | 职责 |
|---|---|
| `src/run.ts` | SDK 驱动：create/send/wait/cancel/dispose → `SubagentRun` |
| `src/provider.ts` | `CursorProvider.start` 调 `startCursorRun`；cwd/key 校验 |
| `src/prompt.ts` | 任务 footer（要求 summary/body 格式） |
| `src/sdk.ts` | 可注入的 SDK 门面（测试替换 `Agent`） |
| `src/result-format.ts` | 已有：解析与展示（必要时小改） |
| `src/failure.ts` | 已有：diagnostic；扩展 `classifySdkError` |
| `tests/run.spec.ts` | fake SDK 契约测 |
| `tests/provider.spec.ts` | 注册 + start 边界 |
| `docs/DESIGN.md` / `CHANGELOG.md` / README | 文档 DoD |

---

## Task 1: SDK 门面 + 可取消 run 驱动

**Files:**
- Create: `src/sdk.ts`
- Modify: `src/run.ts`, `src/failure.ts`
- Test: `tests/run.spec.ts`

**Interfaces:**
- Produces:
  - `createSdkAgent(options)` → `{ agentId, send, cancelCurrentRun?, [Symbol.asyncDispose] }` 抽象（或直接注入 `Agent` 静态方法）
  - `startCursorRun(request, deps): Promise<SubagentRun>`
- Consumes: `resolveChildCwd` / `SessionId` / `settleRunResult`（若可用）或手写等价 never-reject `result`

- [x] **Step 1: 写失败单测（fake agent）**

```ts
// tests/run.spec.ts — 核心用例草稿
it('maps finished run to completed summary-first output', async () => {
  const run = await startCursorRun(fakeRequest({ prompt: 'x' }), {
    createAgent: async () => fakeAgent({
      send: async () => fakeRunHandle({
        wait: async () => ({
          id: 'run-1',
          status: 'finished',
          result: '<summary>ok name</summary><status>ok</status><body>dsh-plugins</body>',
        }),
      }),
    }),
    apiKey: 'test-key',
    model: 'composer-2.5',
    disposeGraceMs: 100,
  })
  const result = await run.result
  expect(result.stopReason).toBe('completed')
  expect(result.output[0]).toMatchObject({ type: 'text' })
  expect(String((result.output[0] as { text: string }).text)).toContain('ok name')
  expect(String((result.output[0] as { text: string }).text)).toContain('<details>')
  await run.dispose()
})

it('maps signal abort to aborted', async () => { /* abort during wait */ })
it('maps status error to stopReason error with cursor: diagnostic', async () => { /* ... */ })
it('rejects start when apiKey missing', async () => { /* expect reject */ })
```

- [x] **Step 2: 跑测确认失败**

```bash
pnpm test -- tests/run.spec.ts
```

Expected: FAIL（`startCursorRun` 未实现或仍 `export {}`）

- [x] **Step 3: 实现 `src/sdk.ts` + `src/run.ts` 最小路径**

要点：

1. `startCursorRun` publication 前：`resolveChildCwd`、校验 apiKey、校验 prompt 非空文本块。
2. `await Agent.create({ apiKey, model: { id }, local: { cwd } })`（经注入门面）。
3. 拼接 prompt = 用户文本 + `TASK_RESULT_FOOTER`（Task 2 可先内联常量）。
4. `const handle = await agent.send(prompt)`；race `handle.wait()` vs `signal` abort → `handle.cancel()`（若 `supports('cancel')`）。
5. 映射 status；成功则 `formatForParent(parseResultText(text))`。
6. 返回 `{ id: SessionId(uuid), localAgent: undefined, result, dispose }`；dispose：abort 标志 + cancel + `agent[Symbol.asyncDispose]()`，memoize。

- [x] **Step 4: 跑测通过**

```bash
pnpm test -- tests/run.spec.ts
```

Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求提交时执行；否则停在工作树）

```bash
git add src/sdk.ts src/run.ts src/failure.ts tests/run.spec.ts
git commit -m "$(cat <<'EOF'
feat(cursor): add cancellable SDK one-shot run driver

EOF
)"
```

---

## Task 2: Prompt footer + provider 接线

**Files:**
- Create: `src/prompt.ts`
- Modify: `src/provider.ts`, `src/index.ts`（若需把 apiKey 从 env 抽出）
- Test: `tests/provider.spec.ts`, `tests/prompt.spec.ts`

**Interfaces:**
- Produces: `wrapTaskPrompt(userText: string): string`；`CursorProvider.start` → `startCursorRun`
- Consumes: Task 1 的 `startCursorRun`

- [x] **Step 1: 写 prompt / provider 失败测**

```ts
// tests/prompt.spec.ts
it('appends summary/status/body contract footer', () => {
  const wrapped = wrapTaskPrompt('List package name')
  expect(wrapped).toContain('List package name')
  expect(wrapped).toContain('<summary>')
  expect(wrapped).toContain('<status>')
  expect(wrapped).toContain('<body>')
})

// tests/provider.spec.ts
it('start rejects when parent has no cwd', async () => { /* ... */ })
it('start delegates to startCursorRun with resolved cwd and apiKey from env', async () => { /* spy */ })
```

- [x] **Step 2: 跑测确认失败** → `pnpm test -- tests/prompt.spec.ts tests/provider.spec.ts`

- [x] **Step 3: 实现 footer + 替换 scaffold `start` reject**

`wrapTaskPrompt` footer 文案（固定中英均可，保持稳定便于测）：

```text
---
When finished, reply in exactly this shape (no other wrapping):
<summary>one plain-language sentence</summary>
<status>ok|partial|blocked</status>
<body>
evidence and details (paths, commands, what was not done)
</body>
If you could not complete the work, use status partial or blocked — never claim ok without evidence.
```

`provider.start`：从 `request.prompt` 拼文本 → `wrapTaskPrompt` → `startCursorRun`；`apiKey = config.env.CURSOR_API_KEY`。

- [x] **Step 4: 全量测试 + build**

```bash
pnpm test && pnpm run build
```

Expected: 全部 PASS；`lib/` 更新

- [ ] **Step 5: Commit**（若用户要求）

```bash
git add src/prompt.ts src/provider.ts tests/
git commit -m "$(cat <<'EOF'
feat(cursor): wire provider start to SDK run with result footer

EOF
)"
```

---

## Task 3: 文档 DoD + 版本点

**Files:**
- Modify: `docs/DESIGN.md`, `docs/ROADMAP.md`, `README.md`, `README.zh.md`
- Create: `CHANGELOG.md`
- Modify: `package.json` version → `0.1.0`（或 `0.0.1`；推荐 **0.1.0** 表示首个可委派实现，未 npm publish 亦可）

- [x] **Step 1: 更新 DESIGN「Sprint 0 落地」**：SDK create/send、结果映射表、配置字段
- [x] **Step 2: ROADMAP**：Phase 0 迁「已交付」
- [x] **Step 3: README 双语最小启用 YAML（provider + tool-subagent 行）
- [x] **Step 4: CHANGELOG + 回顾三问**

```markdown
## 0.1.0
- feat: Cursor one-shot subagent provider via @cursor/sdk
- 回顾：顺利=…；坑=…；是否流程缺陷=…
```

- [x] **Step 5: 再跑 `pnpm test && pnpm run build`** 确认文档改动无破坏

---

## 明确不在本 Sprint

- credentialed 真机冒烟（Phase 1）
- acceptance 探针 / conversation 遥测（Phase 2）
- `dsh-subagent-router` 集成
- npm publish / CI workflow（可另开）

---

## 自检（对照 DEVELOPMENT + DESIGN）

| 要求 | 任务 |
|---|---|
| B1 可委派 | Task 1–2 |
| B2 summary-first | Task 1 用已有 `formatForParent` + Task 2 footer |
| 取消 | Task 1 abort 用例 |
| Fake SDK CI | Task 1 注入门面 |
| Host-only / 无 client | 全局约束 |
| 不做「保证做完」 | Backlog B6 延期 |

无 TBD 占位；类型名与 `SubagentRun` / `RunResult` 公开 API 对齐。

---

## 执行状态

Plan 已保存到 `docs/plans/2026-08-21-sprint-0-cursor-provider.md`。

（已执行完毕，2026-08-30 补记）
