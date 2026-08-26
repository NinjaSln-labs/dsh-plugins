# C1 设计定稿 — host 配置点接入（`installSettingsSection` getter 模式）

> 状态：**调研完成，设计定稿待确认**（ROADMAP 规则：未定稿不动工）
> 调研基准：harness `0.1.1-rc.2`（live）· `@deepseek-ai/dsh-settings@0.1.1-rc.2`（harness 自带）与 `0.1.0-rc.6`（npm peer 基线，tarball 实测）
> 调研日期：2026-08-26

## 1. 背景与目标

现状：`apply(ctx, config)` 里 `resolveConfig(config)` 一次，闭包分发给投影/工具/命令/overview RPC——配置改动需重启 + 存在**双源**（schemastery `Config` schema 的 `.default()` 与 `resolveConfig` 的 `??` 回退必须手工同步，config.ts 内有双源警告注释）。

目标：

1. 配置单一权威——schema 成为唯一默认值来源，治愈双源
2. 阈值类配置 **live 生效**（改 `windowCritical` → badge 下一帧即变）
3. 设置 UI 可调（为 C2 client 卡片铺路）

## 2. 调研事实（全部实测）

| # | 事实 | 证据 |
|---|---|---|
| F1 | **`ctx.settings` 在 live harness 已挂载**（web profile 无需加行） | Inspect `Service.listService` 实测：`settings: Abstract settings service` |
| F2 | `installSettingsSection(ctx, ns, schema, entry, hooks)` 是官方可选消费者封装：`inject('settings')` → `register(ns, schema, { base: entry, validate })` → `setSource(() => scope.get())`；服务卸载时 `setSource(() => entry)` 回退 + `onChange()`；`scope.watch(onChange)` 推送变更。无 settings 服务时 inject 子 fiber 永远 pending = **天然 optional** | dsh-settings lib/index.js L618-637 |
| F3 | **参考实现**：`dsh-agent-default-model` —— `this.source = () => entry` 初始化 → `setSource(current) { this.source = current }` → 读侧 `currentSelection() { return selection(this.source()) }`；写侧 `ctx.get('settings')?.replace(ns, …)` | dsh-agent-default-model/lib/index.js L35-70 |
| F4 | **rc.6 已含 `installSettingsSection` + `applies`** → peer 可新增 `@deepseek-ai/dsh-settings: ^0.1.0-rc.6`，符合「局部升」策略，不全局升 | npm rc.6 tarball 解包 grep 实测 |
| F5 | `SettingsScope`：`get()`（live 读）、`watch(cb)`（提交后推送 next/prev）、`update/replace/mutate`（写，带 revision 乐观锁 `SettingsConflictError`） | types/index.d.ts |
| F6 | `applies: 'live' | 'restart'` 只是**给配置 UI 的展示口径**，运行时不强制——生效与否取决于消费方是否走 getter | types/index.d.ts L28 |
| F7 | `validate(value)` 跨字段校验：写时拒绝（refuse the write）；注册后坏 section 保留 last good value 并 warn | SettingsRegisterOptions 文档 |
| F8 | `describe({ redactSecrets: true })` 是 wire 面板的强制口径（C2 用）；`settings.plugin.item` keyed slot 的 key 自定义（C2 契约，此前 Inspect Slots 树已确认） | SettingsDescribeOptions / Slots 树 |

## 3. 设计

### 3.1 命名与挂载

- ns = **`'context-compass'`**（`settingsNamespace()` brand；小写 kebab-case，插件短名，全局唯一）
- `apply()` 内：

```ts
let source: () => ResolvedConfig = () => resolveConfig(config)   // 初始回退（F3 同款）
installSettingsSection(ctx, settingsNamespace('context-compass'), Config, config, {
  setSource: current => { source = () => normalize(source0(current)) },
  onChange: () => rejudgeRegistrationFacts(),
  validate,   // 见 3.4
})
```

- `entry = config`（loader 已过 Config schema 归一化，defaults 已填 → base 层完整）
- **双源治愈**：live 路径默认值全部来自 schema 解析；`resolveConfig` 降级为「纯函数测试路径」专用，双源警告注释改为指向本设计

### 3.2 消费点改造（getter 化范围）

| 消费点 | 现状 | 改造 | 生效 |
|---|---|---|---|
| 投影 `wireView` | 闭包 `config` | `healthView(state, source(), …)`——每帧读 source | **live**（badge 下一帧即变） |
| 工具 `sessionHealthTool` | 闭包 `resolved` | `assess(…, source(), …)` 每次 execute 读 | **live** |
| 命令 `healthCommandDefinition` | 闭包 `resolved` | 同上，每次 handler 读 | **live** |
| overview RPC `handleOverviewRpc` | 传 `config` | 传 `source()`（排序/阈值/摘要同源） | **live** |
| pricing `startPricingRefresh` | apply 时读 `cost.priceSource/urls/refreshHours` 一次 | **不改**——刷新 wiring 保持启动时形态 | **restart**（文档注明） |
| `projection.enabled` | apply 时 if 分支 | `onChange` 重判定：保留 disposer，变更时 dispose + 条件重注册 | **live**（onChange 已给时机） |

> 方案 B（备选，可后续增量）：`scope.watch` 里对 cost 源字段变化重启 pricing refresh wiring（~20 行），把 restart 收窄为无。首版不做，保持 diff 最小。

### 3.3 `applies` 取舍

**单 ns `'context-compass'`，`applies: 'live'`（默认，不必显式传）**。理由：

- 绝大多数字段（thresholds×8 / checks×5 / cost 显示两项）真实 live
- 仅 `priceSource/priceUrl/priceFallbackUrl/priceRefreshHours` 4 项实际 restart——在 schema 的 `.describe()` 文案里注明「需重启生效」，UI 口径可接受
- 拆双 ns（thresholds/checks live + cost-source restart）会让 C2 卡片与文档复杂化，收益不成比例

### 3.4 `validate`（跨字段，schema 表达不了的）

```ts
windowMid < windowHigh < windowCritical   // 三档单调
economyWindowRatio、messageCountWindowRatio ∈ [0,1]  // schema 已管，不重复
```

抛错即拒绝该次写入（F7 语义），用户在 UI 立刻得到反馈。

### 3.5 peer 影响

- `peerDependencies` **新增** `"@deepseek-ai/dsh-settings": "^0.1.0-rc.6"`（rc.6 tarball 实测含 `installSettingsSection`/`applies`，F4）；其余 peer 不动
- `devDependencies` 加同版本供类型/测试
- 导入方式：`import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'`——宿主注入，bundle 无增量

### 3.6 测试计划

| 层 | 用例 |
|---|---|
| 单元（smoke） | source 切换后各消费点行为变化（复用 S3 的每字段断言矩阵——把「改 config」换成「切 source」） |
| 集成（smoke） | 内存 stub `SettingsProvider`（实现 `load/persist/writable`）+ 真实 `installSettingsSection`：register → update → watch 触发 → source() 反映；`validate` 拒绝单调性违规；服务卸载回退 entry |
| mount | 无 settings 服务的 Context → source 恒为 entry（F2 的 optional 语义）；有 → 注册发生 |
| S2 | wire 键集合不变（C1 不动 payload） |

### 3.7 C2 前置契约（简要，本次只记录不实施）

- Client 卡片：`settings.plugin.item` keyed slot，key 自定（如 `'context-compass'`）
- 数据面：Host 侧已有 RPC 通道（`/context-compass-rpc`）可转发 `describe({redactSecrets:true})` / `update(ns, patch, expectedRevision)`
- 场外插件不可复用内置控件（bundle 门禁）→ 自建表单 + 草稿暂存 + revision 设栅（`SettingsConflictError` 兜底）
- 风险：schemastery schema 的 UI 渲染兼容性（嵌套 object + union `priceSource`）需 C2 实测

## 4. 风险与未决

| 风险 | 缓解 |
|---|---|
| settings-file 的 `writable` / 文档路径在本部署的行为 | 实施时先跑只读探针（`describe()`）确认 |
| `normalize(source0(current))`——settings 解析值与 `ResolvedConfig` 的形状差（checks.handoff.paths 等嵌套默认） | schema 与 ResolvedConfig 同构（loader 归一化已验证），实施时加形状断言测试 |
| thresholds live 生效的 UX（badge 颜色突变） | 属预期行为；advice 文案本就每帧重算 |
| ns 全局唯一冲突 | `'context-compass'` 与插件名一致，冲突概率极低；register 重复会 fail loud |

## 5. 实施切分（定稿后）

1. **T1**：source thunk + installSettingsSection 接线 + 消费点 getter 化（投影/工具/命令/RPC）+ projection.enabled 重判定
2. **T2**：validate 单调性 + 集成测试（stub provider）+ S3 矩阵切换 source 复用
3. **T3**：peer/devDeps + README/HANDOFF/ROADMAP 回填 + 发版 0.10.0（或 0.9.x）
