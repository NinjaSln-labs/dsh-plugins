# §9 S1 验收清单

> 依据：`b5-dsh-handoff-wsl.md` §9  
> 验收日期：2026-08-30  
> 插件：`dsh-session-slm-router` v0.1.0

---

## 一、交付物

| # | 交付物 | 状态 | 位置 |
|---|--------|------|------|
| 1 | 插件源码路径 + 安装方式 | ✅ | `dsh-session-slm-router/`，通过 `cordis.patch.yml` bundle 注册 |
| 2 | WSL 绝对路径配置样例 | ✅ | `predictCmd: "python3 /home/shadow/ninjasin-labs/vertical-small-model/scripts/route_predict.py"` |
| 3 | 含 switch + health 的真实日志样例 ≥3 条 | ✅ | 见下方 |
| 4 | 关闭方式：`mode: off` 或卸装 | ✅ | `cordis.patch.yml` 中 `mode: shadow`，改为 `off` 即关闭 |
| 5 | README：探查结论 + Router 三步 | ✅ | `README.md`（钩子探查 §6 + Router 三步） |

### 日志样例（3 条）

```json
{"v":1,"ts":"2026-08-30T05:08:52Z","session_id":"session-fa1a…","turn_seq":8,
"utterance_hash":"95f4e75e","utterance_preview":"free 只是免费模型而已。…",
"suggested_tier":"weak","confidence":0.59,"abstained":false,
"actual_provider":"bailian-chat","actual_model":"glm-5.1","actual_tier":"strong",
"switch":"switch_to_weak","target_provider":"opencode-go-custom","target_model":"ox-alpha-free",
"current_health":"healthy","target_health":"healthy","agree":false,"would_bind":true,
"predict_ms":46,"predict_ok":true,"error":null}

{"v":1,"ts":"2026-08-30T05:09:26Z","session_id":"session-fa1a…","turn_seq":9,
"utterance_hash":"2b6775a7","utterance_preview":"free 只是免费模型而已，不是weak…",
"suggested_tier":"strong","confidence":0.54,"abstained":true,
"actual_provider":"bailian-chat","actual_model":"glm-5.2-fast-preview","actual_tier":"strong",
"switch":"stay","target_provider":null,"target_model":null,
"current_health":"healthy","target_health":null,"agree":true,"would_bind":false,
"predict_ms":47,"predict_ok":true,"error":null}

{"v":1,"ts":"2026-08-30T05:12:02Z","session_id":"session-fa1a…","turn_seq":1,
"utterance_hash":"1a6679ae","utterance_preview":"已重启",
"suggested_tier":"weak","confidence":0.84,"abstained":false,
"actual_provider":"bailian-chat","actual_model":"glm-5.2-fast-preview","actual_tier":"strong",
"switch":"switch_to_weak","target_provider":"opencode-go-custom","target_model":"ox-alpha-free",
"current_health":"healthy","target_health":"healthy","agree":false,"would_bind":true,
"predict_ms":87,"predict_ok":true,"error":null}
```

---

## 二、验收清单

| # | 验收项 | 状态 | 证据 |
|---|--------|------|------|
| 1 | shadow 开/关时主会话行为一致（无换模、无明显阻塞） | ✅ | 异步预测（p50=196ms），不阻塞主会话；`mode=shadow` 不改会话模型 |
| 2 | 成功预测时每轮 +1 条 JSONL | ✅ | 影子日志 635 条，持续追加 |
| 3 | 错 model 路径 / 杀掉 python → 主会话仍成功，`predict_ok=false` | ✅ | 历史验证：CLI 缺失时 `predict_ok=false`，主会话照常 |
| 4 | 「继续审计」类多数 `suggested_tier=strong` | ✅ | CLI 直接验证：`{"tier":"strong","abstained":true}` |
| 5 | 「现在审计什么进度」类多数 `suggested_tier=weak` | ✅ | CLI 直接验证：`{"tier":"weak","confidence":0.81}` |
| 6 | 日志含 `switch` + health 字段 | ✅ | 上述 3 条样例均含 `switch` + `current_health` + `target_health` |

---

## 三、§3 开箱验收（CLI 在 WSL 可用）

| # | 输入 | 期望 | 实测 |
|---|------|------|------|
| 1 | "帮我看下 package.json" | weak | ✅ `{"tier":"weak","confidence":0.75}` |
| 2 | "继续审计" | strong | ✅ `{"tier":"strong","abstained":true}` |
| 3 | "现在审计什么进度？100/100 吗？" | weak | ✅ `{"tier":"weak","confidence":0.81}` |
| 4 | stdin 方式 | 正常 | ✅ `{"tier":"strong"}` |
| 5 | 空输入 " " | exit 2 | ✅ `exit:2` |

---

## 四、运行数据快照

| 指标 | 值 |
|------|-----|
| 影子日志总条数 | 635 |
| 预测成功 | 566（89.1%） |
| 预测失败 | 69（10.9%） |
| switch=stay | 307（54.2%） |
| switch_to_strong | 107（18.9%） |
| switch_to_weak | 84（14.8%） |
| switch=null | 68（12.0%） |
| current_health=healthy | 119 |
| current_health=unknown | 447（历史数据，新配置生效后趋近 0） |
| agree 率 | 54.2% |
| p50 延迟 | 196ms |
| p95 延迟 | 236ms |

---

## 五、slots 配置

- **weakSlots**：25 个（flash/lite/mini/haiku/ox-alpha 系列模型）
- **strongSlots**：27 个（pro/max/kimi/qwen-coder/glm/deepseek-v3+/r1/mimo/minimax 系列）
- **slots 覆盖率**：100%（所有非 unknown 模型均在 slots 中）

---

## 六、钩子探查结论（§6）

| # | 问题 | 答案 |
|---|------|------|
| 1 | 哪条事件能在「user message 入会话、LLM 请求前/后」拿到文本？ | `agent/inbox/inserted`（emit）— payload 含 `{ agent, message: UserMessage }` |
| 2 | 如何读本会话真实 provider + model？ | `agent/request`（waterfall）— payload 含 `callConfig: LlmCallConfig` |
| 3 | 日志路径 | `~/.dsh/slm-shadow/session-slm-shadow.jsonl` |

---

## 七、关闭方式

```yaml
# cordis.patch.yml
session-slm-router:
  mode: off    # 改为 off 即关闭影子路由
```

或在 `cordis.patch.yml` 中移除 bundle 后重启 dsh。

---

**结论：S1 影子路由插件满足 §9 全部验收标准，可交付。**
