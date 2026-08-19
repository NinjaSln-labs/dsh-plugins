# 会话列表健康点 — harness slot 提案

[English](#english) | [中文](#中文)

## 中文

### 背景

- `dsh-context-compass` 的头部徽章挂在 `conversation.session.header.utilities`——只覆盖**当前打开**的会话。
- 会话列表（侧栏 `WorkspaceBrowser`，整体占用 `sidebar.workspaces` slot）逐行展示会话，但**没有 per-row 渲染位**，社区插件无法在行内挂组件。

### 数据层已就绪（无改动需求）

`session.list` 每行经 apiproxy `listProjectionsFor` 携带完整投影块（`values` 为宽记录，含 `sessionHealth`）：

- 在线会话：`sessionProjections.snapshot(session)` 实时快照；
- 冷会话（未打开过）：`sessionProjectionCache.cachedSnapshot(meta)` 读持久化投影缓存（stateVersion 4+ 的 `sessionHealth` 行，含 severity/ratio/金额字段）。

客户端 `SessionSummary.projectionValues.sessionHealth` 直接可读——**渲染位到位即用，数据层零改动**。

### 提案：`session.row.trailing` slot

```ts
// ui-workspace（或 ui-conversation）声明：
//   'session.row.trailing': { kind: 'list', scope: 'session', owner: ConversationHeaderActionOwnerProps }
// 渲染在会话行尾部（trailing，与重命名/归档操作同侧）
```

插件侧（已可先行备好，`slots.inject` 对未声明 slot 静默 inert——已核实 `runtime/src/client/slots.ts`：
`if (spec === undefined) return`，声明出现后自动 reconcile 激活，无需改插件）：

```tsx
export const inject = ['slots', 'sessions', 'remote', 'remote.commands', 'locale']
// apply 内：
ctx.slots.inject('session.row.trailing', () => ctx.slots.register(
  { name: 'session.row.trailing', id: 'session-health-dot', order: 10 } as never,
  (props: { sessionId: string }) => (
    <HealthListDot sessionId={props.sessionId} sessions={sessions} commands={commands} locale={locale} />
  ),
) as never)
```

`HealthListDot`：复用 header 徽章的数据管线（`faceOf('sessionHealth')` 订阅 + `contextPressure` 合并 + 忙闲时金额），渲染为小色点（绿/蓝/黄/红/灰，与徽章同源），悬停 tooltip，点击打开该会话并运行 `/compass`。样式走 `<style data-plugin>` 契约（HMR 可清理）。

### 验收标准

- 列表每行尾部出现健康色点，与头部徽章同数据源（投影帧，零轮询）
- 冷会话也有值（投影缓存），无值显示灰点
- 悬停 tooltip 含 severity/占用/计费预期；点击跳转会话并运行 `/compass`
- a11y：色点非纯颜色传达（aria-label 含判定文案）
- 卸载/HMR：`style[data-plugin="dsh-context-compass"]` 正常清理

### 落地顺序

1. harness 侧新增 `session.row.trailing` slot 声明（ui-workspace，含类型合并）
2. 插件启用上述注册代码（slot 存在即生效），bump 版本发布
3. 验证列表点 + 回归头部徽章

---

## English

### Background

- The header badge mounts at `conversation.session.header.utilities` — it only covers the **currently open** session.
- The session list (sidebar `WorkspaceBrowser`, which occupies the whole `sidebar.workspaces` slot) has **no per-row render seat**, so a community plugin cannot mount anything inside a row.

### Data layer is ready (no changes needed)

Each `session.list` row already carries the full projections block via apiproxy `listProjectionsFor` (a wide record including `sessionHealth`): live sessions cut the registry snapshot; cold sessions read the persisted projection cache (`cachedSnapshot`) — `SessionSummary.projectionValues.sessionHealth` is directly readable client-side. **The render seat is the only missing piece; the data layer needs zero changes.**

### Proposal: `session.row.trailing` slot

Declare in ui-workspace (or ui-conversation):
`'session.row.trailing': { kind: 'list', scope: 'session', owner: ConversationHeaderActionOwnerProps }` — rendered at the row tail, next to rename/archive actions.

Plugin side can ship the registration preemptively: `slots.inject` on an undeclared key is silently inert (verified in `runtime/src/client/slots.ts`: `if (spec === undefined) return`), and it reconciles automatically once the declaration appears — no plugin change needed later. `HealthListDot` reuses the header badge's data pipeline (sessionHealth face + contextPressure merge + period-aware money) as a small severity dot with hover tooltip and click-to-open + `/compass`.

### Acceptance

- Per-row dots in the session list, same projection frames as the header badge (zero polling)
- Cold sessions show cached values; gray when absent
- Tooltip with severity/occupancy/cost; click opens the session and runs `/compass`
- a11y: not color-only (aria-label with the verdict text)
- HMR/unload cleans `style[data-plugin="dsh-context-compass"]`

### Sequencing

1. Harness adds the `session.row.trailing` slot declaration (ui-workspace + SlotMap type merge)
2. Plugin enables the registration above (activates as soon as the slot exists), bumps and publishes
3. Verify list dots + regress the header badge
