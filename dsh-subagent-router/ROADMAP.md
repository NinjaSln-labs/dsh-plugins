# dsh-subagent-router — Roadmap

状态基准：v0.1.1（2026-08-15 上线，git 自动发布管道已跑通）。本文件是路线图的**唯一权威来源**（单源）；HANDOFF.md 只记录 delta 并引用本文件。

## 已交付（v0.1.x）

- `subagent_model`：每次委派显式指定 provider / model / max_tokens
- `model: "auto"`：内置路由策略——锚定父模型（默认）、任务分档（trivial/standard/complex）、失败升级（只升不降）、全程可审计（`[auto]` 行 + reason）
- `subagent_models`：实时 provider + 模型目录
- 发布管道：tag `subagent-router-vX.Y.Z` → 版本守卫 → 验证链（typecheck + 30 测试 + build）→ 人工审批（environment `npm-publish`）→ 自动 publish

## Phase 1 — 打磨与实测（v0.2.x）

| # | 项 | 动机/价值 | 依赖 |
|---|---|---|---|
| 1a | `backgroundMode: continuable` 运行时实测（spawn 具备 `prepareContinuable`） | 后台委派是主力场景，不能只靠单测 | — |
| 1b | profile 级 config 覆盖实测（`enableAuto` / `autoEscalate` 等真实生效验证） | 配置面闭环 | — |
| 1c | **目录元数据**：`subagent_models` 输出加 cost 档 / 速度 / 特长 / 上下文标注 | 一切智能选型的地基，推荐引擎的输入 | — |
| 1d | auto 策略参数化：档位阈值、升级次数上限、**预算上限**（maxCost / tier ceiling） | 防升级失控；升级次数现在硬编码 1 | — |

## Phase 2 — 智能推荐（v0.3.x）

| # | 项 | 动机/价值 | 依赖 |
|---|---|---|---|
| 2a | **`subagent_recommend` 工具**：任务描述 → 推荐 provider/model + reason；复用 knowledge L1 扩展模式（一次小模型调用 + 归一化缓存 + 超时降级） | 比命名启发式准一个量级 | 1c |
| 2b | **失败反馈闭环**：按 任务类型×模型 记录成功/失败/耗时，反哺策略与推荐 | 长期差异化；轻量自存或对接 session-health | 2a |
| 2c | **同模型多 route 感知**：同一 model id 在多个 provider 注册时按成本/延迟选 route | 自动选择不应忽略路由维度 | 1c |
| 2d | 预算仪表：auto 决策历史（每任务选了谁、花了多少、升级几次）可查 | 可审计性从单次升级到全局 | 1d |

## Phase 3 — 生态（远期）

- 子代理自主升级：任务中途自调 `subagent_model` 换强模型继续
- 会话级策略：per-session 默认策略（如「一律锚定父模型、不升级」）
- 与 session-health 打通：选型直接吃真实计价数据（CNY/USD），替代命名启发式
- 沉淀为 preset 行，其他 profile 一行启用

## 优先级建议（当前决策）

**1a + 1c + 1d 先做**：1a 补齐后台路径实测；1c + 1d 是 2a/2b 的前置。1b 顺带在 1a 时验证。2a（推荐引擎）是最大单点，单独一轮做。

## 明确不做

- 无审计的黑盒自动选型（任何 auto 决策必须带 reason）
- 硬编码模型名单的策略（目录是活的，策略必须数据驱动）
- 替用户省钱作为唯一目标（任务匹配优先，省钱次之）

## 维护规则

- 路线图变更（新增/重排/完成）→ 更新本文件，HANDOFF §3 只记 delta
- 完成项移入「已交付」或归档 `HANDOFF-ARCHIVE/done.md`
- 版本映射：Phase 1 → 0.2.x，Phase 2 → 0.3.x；发布一律走 git 管道
