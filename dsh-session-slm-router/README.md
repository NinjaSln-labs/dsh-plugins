# dsh-session-slm-router

Shadow-mode SLM router for DeepSeek Harness. Per-turn weak/strong prediction
via the `vertical-small-model` CLI; writes a shadow JSONL log **without
changing the active session model** (S1 only).

> ⚠️ 仓库存在 /mnt/e（WSL E 盘）与 /home/shadow 两份副本，/mnt/e 副本 git 停留在历史改写前（52646e37），一切以 /home/shadow/ninjasin-labs/dsh-ecosystem/dsh-plugins 为准。

## 插件源码路径

```
/home/shadow/ninjasin-labs/dsh-ecosystem/dsh-plugins/dsh-session-slm-router/
├── src/
│   ├── index.ts       # 主插件：hook 注册 + router 逻辑 + shadow writer
│   └── config.ts      # 配置 schema + resolveConfig
├── lib/               # TypeScript 编译产物（ESM）
├── cordis.patch.yml   # bundle 注册行
├── package.json
└── tsconfig.build.json
```

## Hook 探查结论（§6 要求）

| # | 问题 | 答案 |
|---|------|------|
| 1 | **哪条事件能在「user message 入会话、LLM 请求前/后」拿到文本？** | `agent/inbox/inserted`（emit）——payload 含 `{ agent, message: UserMessage }`，message.content 是 ContentBlock[]，从中过滤 `type: "text"` 块拼接。备选：`agent/pre-step`（waterfall）可拿到 `messages: UserMessage[]` 但需逆向最后一个 assistant step 前的 user message，更复杂且可能错过多轮对话中的历史消息。 |
| 2 | **如何读本会话真实 provider + model（非仅 default settings）？** | `agent/request`（waterfall）——payload 含 `callConfig: LlmCallConfig`，其中 `.provider` 和 `.model` 是本轮实际使用的值，比 `agentDefaultModel.currentSelection()` 更精确（后者只反映默认配置，不反映 per-call override）。 |
| 3 | **日志路径** | `~/.dsh/slm-shadow/session-slm-shadow.jsonl`（私有 JSONL，一行一条；脱敏：utterance 只保留 sha256 前 16 位 + 前 80 字 preview） |

**为什么不用 `dsh-subagent-router` 冒充主会话切口？**
`dsh-subagent-router` 是子代理路由，不经过主会话；影子路由必须监听主
会话自身的 `agent/inbox/inserted`，保证日志记录的是真实用户发言。

## Router 三步

```
① 强弱  utterance → weak|strong     （子进程调用 route_predict.py）
② 换/不换  suggested_tier vs actual_tier → stay | switch_to_weak | switch_to_strong
③ 健康  current model 是否匹配已知 slot → healthy|unhealthy|unknown
```

- `actual_tier` 由插件自建 `tierOf(provider, model)` 计算，不明 → `unknown`
- **禁止**复用 `vertical-small-model` 的 `model_id_to_tier`（其启发式会污染影子统计）

## 配置（settings.yaml）

```yaml
session-slm-router:
  mode: shadow              # shadow | weak-only | off（禁止 on）
  weakOnlyMainOnly: true    # weak-only 是否只对主会话（roots）换模，子代理仅记录
  predictCmd: "python3 /home/shadow/ninjasin-labs/vertical-small-model/scripts/route_predict.py"
  predictModel: "/home/shadow/ninjasin-labs/vertical-small-model/data/eval/routing-v0/model-r1.json"
  timeoutMs: 250
  logPath: "slm-shadow/session-slm-shadow.jsonl"
  weakSlots:
    - { provider: agnes, model: agnes-2.5-flash }
    - { provider: commandcode, model: deepseek/deepseek-v4-flash }
  strongSlots:
    - { provider: commandcode, model: deepseek/deepseek-v4-pro }
```

路径统一使用 WSL 本地副本 `/home/shadow/ninjasin-labs/vertical-small-model/`（2026-08-30 起；/mnt/e 为 E 盘旧副本，git 停留在历史改写前，勿再引用）。

## 模式（S2b 裁定落实）

| mode | 行为 |
|------|------|
| `shadow`（默认） | 只预测 + 写影子日志，**不换模**（S1 验收行为） |
| `weak-only`（S3 灰度） | 真正换模，但**只放行 `switch_to_weak`**（A 层 precision 93%）；`switch_to_strong` 记录但 `bound=false`（B 层 38% 过敏不放行）；abstain 回退 stay（C 层 8% 弃权不当 strong） |
| `off` | 关闭 |

weak-only 换模条件（全部满足才 `bound=true`）：
1. 预测建议 `weak` 且当前实际档为 `strong`（`switch_to_weak`）
2. 目标槽健康且目标 **provider 已在 llm 注册**（`llm.listProviders()` 检查）；首选槽不可用时**按序取下一个已注册的 weak 槽**（plan S3「同档下一备选」），全不可用则不换
3. `weakOnlyMainOnly=true` 时仅主会话（`agents.roots()`）换模，子代理只记录不换

**降档只对当轮生效（防单向陷阱）**：bind 后插件记住用户原模型；下一轮先恢复原模型作为决策基准再重新预测决策——连续多轮都判弱则持续降档，一旦不判弱（或用户手动改模）即自动回到用户原选模型，会话不会因一次降档被钉死在弱档。

## 槽位健康缓存（weak-only 换模顺序）

weakSlots 的**配置顺序 ≠ 生效顺序**。插件维护一个持久化健康缓存，决定「换到哪个弱档」：

- 缓存文件：`~/.dsh/slm-shadow/slot-order-cache.json`（**删除即重建**，无需清别的）
- 生效顺序：可用 `free` 槽 → 可用非 free 槽 → 瞬态未知槽（原配置序）→ 死亡槽（沉底）
- 死亡判定两来源：
  - **provider 级**：provider 已从 llm 注销 → 沉底（重验可复活）
  - **model 级**：换模目标实际调用报「模型不可用」类确定性错误（`agent/request-error`，如 404 / NO_ADAPTER / 模型不存在）→ 沉底（保留至缓存过期重建才复活，防止模型误杀）
- 刷新时机：**启动**、**`llm/adapters-updated`**（用户改供应商/模型配置触发）、**24h TTL 过期**
- 配置摘要：缓存存 `weakSlots` 的 sha256 前 16 位——你改过槽位配置 → 摘要变化 → 旧缓存顺序作废重建，不存在的模型不会一直占位
- 瞬态失败（限流/超时/5xx）**不淘汰**，防误杀

> ⚠️ weak-only 换模在 `agent/request` waterfall 内**同步等待预测结果**（最多 `timeoutMs`=250ms）后才发出 LLM 请求——这是 mode:on 的固有代价（必须先决策才能换模），S3 灰度已授权。shadow/off 完全无此开销。

## 日志 schema（~/.dsh/slm-shadow/session-slm-shadow.jsonl，一行一 JSON）

```json
{
  "v": 1,
  "ts": "2026-08-25T12:00:00.000Z",
  "session_id": "…",
  "turn_seq": 123,
  "utterance_hash": "sha256前16",
  "utterance_preview": "前80字…",
  "suggested_tier": "weak",
  "confidence": 0.71,
  "abstained": false,
  "actual_provider": "agnes",
  "actual_model": "agnes-2.5-flash",
  "actual_tier": "weak",
  "switch": "stay",
  "target_provider": null,
  "target_model": null,
  "current_health": "healthy",
  "target_health": null,
  "agree": true,
  "would_bind": false,
  "bound": false,
  "predict_ms": 45,
  "predict_ok": true,
  "error": null
}
```

- `would_bind`（建议层）：决策判定「若换模策略放行且目标健康，本轮会不会换」——shadow 与 weak-only 口径一致
- `bound`（执行层）：weak-only **实际是否换模**；shadow 恒 false。灰度命中率 = `bound=true` 占 `would_bind=true` 的比例

## 安装

已在 `~/.dsh/profiles/web/package.json` 中通过 `file:` 引用注册，并加入
`dsh.profile.bundles`。下次 dsh 启动时自动加载。

```bash
# 源码目录（如需重新构建）
cd /home/shadow/ninjasin-labs/dsh-ecosystem/dsh-plugins/dsh-session-slm-router
node_modules/.bin/tsc -p tsconfig.build.json
cd ~/.dsh/profiles/web && pnpm install   # 重新链接到 node_modules
```

## 测试

```bash
cd /home/shadow/ninjasin-labs/dsh-ecosystem/dsh-plugins/dsh-session-slm-router
npm test        # node --test tests/router.test.mjs（23 用例：判定表/health/tierOf/utterance/超时）
```

## S2 周报（影子对照卡）

数据积累 ≥3 天或 ≥100 条有效事件后运行：

```bash
python3 scripts/shadow_weekly.py          # 默认读 ~/.dsh/slm-shadow/session-slm-shadow.jsonl
```

输出 `reports/b5-dsh-shadow-<date>.md`，含 plan §5 的 9 个指标与 GATE 判定。

## 关闭

```yaml
session-slm-router:
  mode: off
```

或在 `cordis.patch.yml` 中改 `mode: off` / 移除 bundle 后重启 dsh。

## 验收清单（S1）

- [x] shadow 开/关时主会话行为一致——预测在 `agent/inbox/inserted` 后台异步执行（实测 122–225ms），不阻塞主会话
- [x] 成功预测时每轮 +1 条 JSONL——已实测验证
- [x] CLI 失败 → 主会话照常，`predict_ok=false` 落盘——已实测验证（subprocess 缺失场景）
- [x] 「继续审计」类多数 `suggested_tier=strong`——CLI 抽检 + 模拟均验证
- [x] 「现在审计什么进度」类多数 `suggested_tier=weak`——confidence 0.81 实测
- [x] 日志含 `switch` + health 字段——线上实测：stay / switch_to_strong 均正确，health=healthy

**注意：** 插件配置在 `cordis.patch.yml` 行内 config（非 settings.yaml）；
修改 slots/路径后需重启 dsh。

## 明确不做

- 默认启用 `mode: on`
- 改 vertical-small-model 分类器/权重
- 把审批/工具权限交给 SLM
- 用 `dsh-subagent-router` 冒充主会话切口
- 复用 `model_id_to_tier` 填 `actual_tier`
