# AUDIT-0.10.0 — 0.7.13 后新代码面质量审计

> 审计日期：2026-08-26 · 范围：0.7.13 十二轮审计之后新增的三个代码面（C1 settings 链 / R1 sparkline+投影 / overview 性能路径）
> 方法：三个独立只读审计（子代理隔离上下文）+ 关键发现人工核验源码

> 状态口径：fixed（已修，commit `e87b7ca`）/ recorded（记录在案，暂不修）

## 总览

| 面 | 发现 | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| overview 性能路径 | 11 | 0 | 2 | 4 | 5 |
| C1 settings 链 | 6 | 0 | 1 | 2 | 3 |
| R1 sparkline + 投影 | 6 + 6 测试洞 | 0 | 1 | 2 | 3 |

---

## 一、overview 性能路径（11 条）

> 总评：性能架构（同步首帧 + 双后台化 + SWR）实现质量高；风险集中在一致性（幽灵数据无自愈）与安全边界（fail-open + 无 Host 校验）。

### P1

**OV-1 列表空结果永不覆盖缓存——删除全部会话后面板幽灵数据无自愈**
- 位置：`src/overview.ts:254-256`（SWR 后台刷新）与 `:268-271`（冷启动路径）
- 证据：两处均为 `if (Array.isArray(r) && r.length > 0) listCache = …`——合法的「会话全部删空」被当作失败丢弃，旧列表永久残留（仅重启可清）。已人工核验属实。
- 建议：连续 N 次（如 2 次）空结果才采信清空；单次空结果仅刷新时间戳。
- 状态：**fixed（commit e87b7ca）**

**OV-2 isLoopback 对缺失地址 fail-open**
- 位置：`src/overview.ts:432-436`
- 证据：`if (addr === undefined) return true`——socket 形状漂移/异常时静默失去 loopback 防护。已人工核验属实。
- 建议：fail-closed（undefined → 403）。
- 状态：**fixed（commit e87b7ca）**

### P2

**OV-3 无 Host/Origin 校验 → DNS rebinding 可跨源读取**
- 位置：`handleOverviewRpc`；另 `readBody` 不限 Content-Type（text/plain 可免预检）
- 建议：handler 校验 Host 头 ∈ {127.0.0.1[:port], ::1[:port], localhost[:port]}。
- 状态：**fixed（e87b7ca：isLoopback 加 Host 头校验，防 DNS rebinding）**

**OV-4 `__resetOverviewCachesForTests` 漏清 titleCache；运行时无改名/删除事件驱动失效**
- 位置：`src/overview.ts:176-181`
- 影响：会话改名后旧标题最长残留 60s。
- 状态：**fixed（e87b7ca：__resetOverviewCachesForTests 补清 titleCache）**

**OV-5 排序规则 host/client 双份实现，仅靠注释约定同源**
- 位置：`src/overview.ts:56,76-91` vs `src/client.tsx:843,916-929`
- 建议：抽共享纯模块（client bundle 构建可打包 host 源码的纯函数）。
- 状态：recorded（当前逐行等价；client 拆分已落地（55d116e），抽共享排序模块留作后续）

**OV-6 severity 缓存对阈值变更加零感知**
- 位置：coldCache 60s + projection 持久缓存
- 影响：C1 之后 thresholds live 生效，但空闲会话的旧颜色在缓存窗口内残留（SWR 帧仍显示旧 severity）。
- 状态：recorded（阈值改动是低频操作，60s 窗口可接受；C1 设计文档已注明）

### P3

**OV-7** 共享 `listInFlight` 被创建者 signal 污染——并发冷启动时一帧 abort 连累其它帧拿空列表。**fixed（本轮：SWR 后台刷新改用独立 AbortController，不再骑请求帧 signal）**。
**OV-8** summary 对任意已加载会话无鉴权开放；冷会话行点摘要必 404。recorded（本机单用户场景）。
**OV-9** contract-check 冷启动豁免每次无条件重试 + 单样本判定 + postRaw 无超时——持续慢查会被豁免掩盖，间歇性慢查漏检。recorded（工具型检查，可接受）。
**OV-10** TTL 注释漂移（注释 2.5s vs 实际 6s）。**fixed（本轮：注释改 6s）**。
**OV-11** 已检查无问题：XFF 不信任、IPv6 ::1 覆盖、body 限额、单行降级、coldLoad 超时兜底。

---

## 二、C1 settings 链（6 条）

> 总评：核心机制（source thunk、use-time 读取、卸载回退）方向正确且回退语义完整；三个真实缺口都在「启动路径」与「异步时序」上。

### P1

**C1-1 启动时非法存储段直接炸掉整个插件（与 publish 路径 last-good 语义不对称）**
- 位置：`src/index.ts:59`；契约 dsh-settings register()「invalid stored section fails the registration itself」
- 证据：用户手改 settings.yaml 写出非单调阈值后重启——settings 服务先挂载时异常从 apply() 穿出，tool/command/RPC/pricing 全部不注册，插件整体加载失败；settings 晚挂载则 live 配置永不接线且无提示。对比：运行期 publish() 路径是 last-good + warn，反而安全。
- 建议：注册前预读校验存储段，或包一层捕获降级 entry 回退 + warn。
- 状态：**fixed（commit e87b7ca）**

### P2

**C1-2 syncProjectionUnit 重复排队 inject：双注册 + disposer 孤儿**
- 位置：`src/index.ts:91-104`
- 证据：每次 ctx.inject 是独立子 fiber 无去重。常见时序即可触发（无需用户操作）：settings 未挂载时首次 syncProjectionUnit() 排队 inject#1，settings 挂载触发 onChange 再次排队 inject#2（此时 projectionDisposer 仍 null），sessionProjections 挂载后两个回调都注册，双注册 + 第二次赋值覆盖 disposer，第一份永久孤儿。
- 建议：pending 标志保证同一时刻至多一个未决 inject。
- 状态：**fixed（commit e87b7ca）**

**C1-3 NaN/Infinity 绕过 schema 范围校验，手改配置可扭曲经济判定**
- 位置：`src/config.ts` schema + validate（只覆盖 window 三元组）
- 证据：schemastery checkWithinRange 对 NaN 恒 false，economyTokenFloor: .nan 过 min(0)；YAML 外部编辑走 load/publish 绕过写路径的 JSON 形状检查；inputPricePerM: .inf 无 max 直接放行，费用显示 Infinity。不崩溃但产出误导性判定。
- 建议：validate 扩展为全数值字段 Number.isFinite 检查。
- 状态：**fixed（commit e87b7ca）**

### P3

**C1-4** namespace 注册疑似骑 provider fiber 而非调用方 fiber（上游契约疑点，置信中等）——插件 re-apply 可能命中 already-registered。**resolved（本轮 mount 冒烟：共享 provider + 插件 fiber dispose 后 re-apply 正常，注册随插件 fiber 拆除——本侧无坑，疑点排除）**。
**C1-5** handleOverviewRpc 的 readConfig(configSource) 在 try 块外（极端拆除竞态下异常不走 500）。**fixed（e87b7ca：挪入 try + 500 兜底）**。
**C1-6** 默认值双源（schema .default ×18 与 resolveConfig 回退）人工同步漂移风险。recorded（本次逐项比对一致；C1 已降级 resolveConfig 为测试/回退路径，长期可由 schema 单向生成回退表）。

### 已检查无问题（带过）

生命周期回退（isUnloading 守卫、provider 重载无残留）、dispose 无泄漏、inject 永不 resolve 语义、resolveConfig 幂等性（workspaceRoot undefined 保真、paths 引用保留）、错误降级（modelOf try/catch、probe fail-soft、pricing 落静态价、RPC 分类响应）、安全面（::ffff:127.0.0.1 覆盖、safeRelativeName 拦截、rankOf 回退）。

---

## 三、R1 sparkline + 投影（6 条 + 6 测试洞）

> 总评：边界防御与持久化设计扎实，S2 矩阵质量高；但 R1 核心采样语义有一个真实 P1——流式双事件导致 history 每请求双写，趋势系统性失真，且现有测试恰好用「分离请求」构造绕开了它。

### P1

**R1-1 双路径采样重复计数：同一次流式请求产生两个相同样本**
- 位置：`src/projection.ts:138-159`
- 证据：assistant/message 与 assistant/chunk(usage) 两分支各自无条件 pushSample；harness 权威消费者 token-meter 对同一 (turn, step) 做 bucketsEqual 去重（官方佐证：流式先发 chunk(usage)、组装出的 message 携带同一份 usage）。默认流式路径每请求 history 双写，40 采样只覆盖约 20 请求、斜率压平、aria-label「最近 N 次请求」失真。
- 建议：fold 记录最后采样的 (turn, step)，同 step 第二次到达替换或跳过（对齐 token-meter 口径）；aria 改「最近 N 个采样」。
- 状态：**fixed（commit e87b7ca）**

### P2

**R1-2 advice 泄漏字面量「null%」**：proxyHit 晋级 blue 但 ratio 为 null 时，blue else 分支渲染「上下文占用 null%（中等）」。S2 矩阵 base 只有 2 条消息恰好绕开该组合。**待修（本轮）**——该分支对 ratio null 回退无占位文案。

**R1-3 连续两次压缩且首次推理跳过时，陈旧 compressionRatio 被当作「上次压缩比例」展示**：compaction/end 捕获 pre 失败时 foldCompression 直接 return，旧比例保留而 compactions 已 +1。**待修（本轮）**——捕获失败时置 null（本次不可判定）。

### P3

**R1-4** sparkline 归一分母跨模型切换失真（128K 到 1M 假性骤降）。**fixed（e87b7ca：title 注明按当前窗口归一；aria 改「个采样」）**。
**R1-5** 折线触顶描边被 viewBox 裁半像素。**fixed（e87b7ca：.sh-spark overflow:visible）**。
**R1-6** as unknown as ProjectionDefinition 双重断言关闭 unit 形状编译期检查。recorded（运行时键集合守卫已兜底；重构阶段评估收窄断言）。

### 测试覆盖洞（smoke S2/R1 块）

1. 「同一 turn/step 两事件都带 usage」用例——**已补（e87b7ca：r1.mjs 同 step 去重 + 合成事件不塌缩）**
2. 「proxyHit 晋级 blue 且 ratio null」用例——**已补（e87b7ca：r1.mjs null% 文案断言）**
3. 「重放重建 history 与在线折叠一致」等价性断言——**已补（本轮：r1.mjs 双折叠深等）**
4. chunk 路径封顶——**已补（本轮：r1.mjs chunk 45 封顶 40）**
5. compaction 与 chunk 采样交互——**已补（本轮：r1.mjs compaction 后 chunk 触发 foldCompression）**
6. client 渲染边界（全同值/denom 回退/length 边界）无自动化——纯视觉层，知悉。

### 已检查无问题（带过）

内存/持久化成本可忽略、stateVersion 9 重放语义正确（真实 registry 测试背书）、pressureHistory 纯新增字段旧 client 兼容、zod 对 NaN/Infinity 直接拒绝（history 元素无法穿透 schema，防御闭环）、compactIntervalRounds 已收口、tool 渲染有 isFinite 守卫、client 无裸 window 访问、CSS 四档明暗覆盖完整。
