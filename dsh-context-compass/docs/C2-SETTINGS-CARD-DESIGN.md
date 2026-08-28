# C2 设计定稿 — Client 配置卡片（`settings.plugin.item` keyed 自建）

> 状态：**调研完成，设计定稿待确认**（ROADMAP 规则：未定稿不动工）
> 调研基准：harness `0.1.1-rc.2`（live）· `@deepseek-ai/dsh-settings@0.1.0-rc.6` · `@deepseek-ai/dsh-client-ui-settings@0.1.0-rc.6` · `@deepseek-ai/dsh-client-schema-form@0.1.0-rc.6` · `@deepseek-ai/dsh-client-ui-settings-plugins`（harness 内置，0.1.1-rc.2）
> 调研日期：2026-08-27

## 1. 背景与目标

C1 已把 host 配置点接入 settings namespace `'context-compass'`（嵌套 Config：`thresholds`×8 / `checks`×5 / `projection`×1 / `cost`×6，live 生效）。C2 提供浏览器侧的配置卡片，让设置 UI 直接调参，无需重启。

## 2. 调研事实（全部实测）

| # | 事实 | 证据 |
|---|---|---|
| F1 | **`settings.plugin.item` 是 keyed slot，key = 卡片所编辑的 settings namespace；owner props 为空**（`SettingsPluginItemOwnerProps.children?: never`，卡片完全自包含、无 props） | dsh-client-ui-settings-plugins `lib/types/client/slot-contract.d.ts`（harness 内置） |
| F2 | **场外插件不可复用内置卡片的「外观与表单模型」**（bundle 纯净度门禁禁止以值导入）→ 卡片须**自建暂存 + revision 设栅**；但 field 覆盖语义、写入契约是公开的 | settings-plugins README「已知限制」 |
| F3 | **`ctx.settingsScope`（官方 client 传输）的 `set/unset` 只支持顶层标量字段**（`path: [field]` 单段）→ 不适合嵌套 Config | dsh-client-ui-settings `lib/client.js` L78-96 |
| F4 | **Host `ctx.settings.mutate(ns, ops, expectedRevision)` 支持完整嵌套 path**（`['thresholds','windowMid']`）+ revision 乐观锁（`SettingsConflictError` code `SETTINGS_CONFLICT`，附 expected/actual） | dsh-settings `lib/types/index.d.ts` |
| F5 | **`@deepseek-ai/dsh-client-schema-form` 是纯模型层（无 React）**，且已在 build-client.mjs 的 EXTERNAL 表：`rehydrateSchema` / `validateDraft` / `nodeAtPath` / `setPath` / `deletePath` / `hasPath` / `getPath` —— 可复用做 schema 解析与草稿校验 | schema-form README + `package.json` |
| F6 | Host 侧已有 `/context-compass-rpc`（loopback-only）通道，`ctx.get('settings')` 在 webServer 子 context 可读到 settings 服务 | overview.ts + C1 §3.7 |

## 3. 设计

### 3.1 挂载点

`client.tsx` 新增 keyed slot 注册（owner props 为空，卡片无 props）：

```tsx
ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
  { name: 'settings.plugin.item', key: 'context-compass' } as never,
  () => <ContextCompassSettingsCard />,
) as never)
```

`key = 'context-compass'` 与 host namespace 同名——tab 靠这个 key 把「Host 注册的命名空间」与「浏览器注册的卡片」配对（F1）。

### 3.2 Host 数据面（扩展 `/context-compass-rpc`）

`handleOverviewRpc` 新增两个 method（复用同一 loopback 守卫 + JSON body 解析）：

- `{ method: 'settings-describe' }` → `ctx.get('settings')?.describe({ redactSecrets: true })` 过滤 `ns === 'context-compass'`，返回 `{ ok, result: { ns, schema, value, base, user, revision, applies, writable } }`；settings 未挂载 → `{ ok:false, error:'settings unavailable' }`
- `{ method: 'settings-mutate', ns, ops, expectedRevision }` → `ctx.settings.mutate(ns, ops, expectedRevision)`：
  - 成功 → `{ ok:true }`
  - `SettingsConflictError` → **409** `{ ok:false, code:'SETTINGS_CONFLICT', expected, actual }`
  - validate 失败 → **400** `{ ok:false, error }`

> 选 `mutate` 而非 `update/replace`：卡片持有 `redactSecrets` 后的视图，`replace` 会误删密钥字段；`mutate` 的 path-addressed 语义正是为「redacted view」设计的写路径（dsh-settings README）。

### 3.3 Client 卡片表单

组件自 fail 态 fetch `settings-describe` 拉 descriptor：

1. **schema 解析**：`rehydrateSchema(descriptor.schema)` → 活校验器（F5，规避自解析 schemastery envelope）
2. **字段渲染（自建控件）**：按 Config 分组手写控件——
   - `thresholds`（8 项 number）：`windowMid / windowHigh / windowCritical / economyTokenFloor / economyWindowRatio / economyRoundFloor / messageCountProxy / messageCountWindowRatio`
   - `checks`（5 项）：`git.enabled`(bool) + `git.workspaceRoot`(string)、`handoff.enabled`(bool) + `handoff.paths`(string[])、`sessionResume.enabled`(bool)、`processes.enabled`(bool)、`knowledge.enabled`(bool)
   - `projection.enabled`(bool)
   - `cost`（6 项）：`cacheHitDiscount / inputPricePerM`(number)、`priceSource`(select auto/static)、`priceUrl / priceFallbackUrl`(string)、`priceRefreshHours`(number)
3. **草稿暂存**：本地 state，控件渲染暂存文本；保存时才发 `settings-mutate`（脏标记：草稿 ≠ 已存）
4. **覆盖标记与重置**：`hasPath(user, path)` 判定字段是否被覆盖；「重置」= `{ op:'unset', path }` 回退到 `base`/schema 默认
5. **revision 设栅**：保存携带 `describe` 的 `revision`；**409** 时提示「配置已被其它会话修改」，重读 descriptor 并保留草稿（F4）
6. **校验**：写前 `validateDraft`（F5）+ 依赖 Host `validate` 兜底（单调性 / 有限性，C1 已落）

### 3.4 字段 → 写入 ops 映射

保存时把脏字段集合映射为 `ops`：

```ts
// 例：改了 windowMid + 开了 processes + 重置了 priceSource
ops = [
  { op: 'set',   path: ['thresholds', 'windowMid'],  value: 0.42 },
  { op: 'set',   path: ['checks', 'processes', 'enabled'], value: true },
  { op: 'unset', path: ['cost', 'priceSource'] },
]
```

## 4. 风险与未决

| 风险 | 缓解 |
|---|---|
| R1 `settings.plugin.item` 渲染上下文（卡片何时出现、tab 是否 dispatch 本 key）需实测 | owner props 为空 + 卡片自 fetch 不依赖 props；实施 T1 先打桩确认 describe 返回的形状 |
| R2 `rehydrateSchema` 执行 `new Function`（schema-form README 已知限制） | 同源信任（describe 来自本机 loopback RPC）；可接受 |
| R3 `describe` 返回的 `schema` 信封结构（schemastery `toJSON`）不稳定 | 全部经 `rehydrateSchema` 还原，不自解析；T1 实测形状 |
| R4 settings 未挂载（headless） | describe 返回 `settings unavailable`，卡片渲染「配置不可用」空态 |

## 5. 实施切分（定稿后）

1. **T1**：Host `handleOverviewRpc` 加 `settings-describe` / `settings-mutate` 转发 + smoke 测试（describe 形状 / mutate 嵌套 path / 409 冲突 / 400 校验失败）
2. **T2**：Client 卡片组件（schema-form 复用 + 自建控件 + 草稿 + revision 设栅）+ 注册 slot + client-mount 入口断言
3. **T3**：README/ROADMAP/HANDOFF 回填 + 发版 0.12.0
