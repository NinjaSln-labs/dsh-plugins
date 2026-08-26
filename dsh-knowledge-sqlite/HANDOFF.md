# HANDOFF — dsh-knowledge-sqlite

> 工程交接文档。**只记 delta**：README/docs/CHANGELOG/commit 已有的内容一律引用不复制。
> 详情权威：`git log`（commit message）> `docs/EXPERIMENTS.md`（实验证据）> `docs/DESIGN.md`（V1.11 契约）。

## 1. 交接元信息

- 日期：2026-08-16 · 交接方：本会话 agent · 接收方：下一 session / 其他 agent
- 项目一句话：DeepSeek Harness 的跨会话知识插件——`ctx.knowledge` 服务 + `knowledge_*` 工具，SQLite FTS5 trigram + L1 查询扩展 + `knowledge_probe` 门禁套件
- 当前版本：**0.1.6**（npm 已发布，CI 工作流发布，宿主 profile 已装载）
- 文档入口：[README](README.md)（功能/配置）· [docs/DESIGN.md](docs/DESIGN.md)（V1.11 契约）· [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md)（门禁数据 §5–§9）· [docs/REVIEWS.md](docs/REVIEWS.md) · [CHANGELOG.md](CHANGELOG.md)
- 接收方建议动作：
  1. 先读本 HANDOFF §3（下一步）+ EXPERIMENTS §9（最近根因）
  2. 用 `project-handoff` 技能维护本文件；发版流程见 §4
  3. 凭据：`~/.dsh/.credentials.yaml`（路径引用，勿读值勿外传）

## 2. 当前状态快照

| 域 | 状态 |
|---|---|
| npm 发版 | 0.1.6 ✅（tag → CI → 审批门 → publish）|
| 宿主部署 | `~/.dsh/profiles/web` 装载 ^0.1.6；patch 配置见 §4 |
| 测试 | vitest **38 项全绿**（store 19 + service 19）；smoke 复现 A 7% / C 21% / D 50% / human A 65% / human C 71% |
| 门禁 | hard L1 ≥30% PASS、human ≥50% PASS、contract 12/12、none 无误报 PASS、variance 双 PASS；**p95 ≤2.0s 未过**（见 §3 待决） |

版本控制：monorepo `dsh-plugins`（origin: github.com/NinjaSln-labs/dsh-plugins），main 分支干净无未提交变更。构建环境：Node 24 / tsc 纯 TS；语料 fixture 已入库（tests/fixtures/corpus，hermetic，CI 可跑）。

最近完成（一行式，详情看 commit）：

- [4ad38c7] 0.1.6 扩展显式关闭思维链 reasoningEffort off（根因分析见 EXPERIMENTS §9）
- [01824de] EXPERIMENTS §8：持久化缓存验证 + timeoutMs 3000 结论
- [492a840] 0.1.5 L1 扩展缓存持久化（expansion_cache 表）+ timeoutMs 默认 3000
- [b08233f] EXPERIMENTS §7：C 臂诊断（A65/C71/L1-live）
- [eaf8178] 0.1.4 human 套件 C 臂 + human-expanded.json 入库
- [52d442c] 0.1.3 probe 语料路径对齐 + precision@1/none 检查；fixture 入库（e6b774f）

未完成边界：`queryExpansion.provider` 配置**未实现**（§3 决策项 B）；p95 门禁口径修订**未做**（决策项 A'）。

## 3. 下一步与验证点

### 立即待办（唯一悬而未决的决策——用户尚未拍板）

**扩展延迟路由问题**（根因链完整，见 EXPERIMENTS §9）：扩展请求跟随会话默认模型路由。
当前默认 opencode-go/deepseek-v4-flash（reasoning 模型）：

| 路由 | TTFT | 总耗时 | timeout3000 降级率 |
|---|---|---|---|
| opencode-go + thinking off（现状 0.1.6）| ~2.0s | 3.4s | 53-82% 波动 |
| opencode-go thinking on（0.1.5 及前）| 3.4s | 11.3s | 100% |
| **deepseek 官方直连**（deepseek-official 路由）| **~107ms** | ~1.5s | —（未被使用）|

- 决策 A：接受现状（缓存命中≈0 延迟已兜底真实使用）
- 决策 B（agent 推荐，用户曾犹豫）：0.1.7 加 `queryExpansion.provider` 配置支持 → 显式 `deepseek-official`（官方直连实测 107ms、无 thinking；用户顾虑「官方思维链全开」已被 curl 实测排除）
- 附带决策 A'：p95 ≤2.0s 门禁口径修订（生产缓存口径 vs fresh 口径）→ 文档决策，连续 3 次 FAIL 全是网关环境变量

### 验证点（任何改动后回归）

```sh
npm test && node test-smoke.mjs          # 本地：38 项 + 冒烟数字不变
# 宿主：knowledge_probe { suite:'hard'|'human'|'latency', fresh:true } —— 数字对照 EXPERIMENTS §6-§9
```

### 外部依赖来源

- DeepSeek 官方 key：`~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`（human variants 再生成脚本 `research/memory-knowledge-seam/experiments/memory-experiment/gen-human-expanded.mjs` 用）
- 会话默认模型：`~/.dsh/settings.yaml` 的 `agent-default-model`（现为 opencode-go/deepseek-v4-flash，**用户明确要求保留**）
- 实验语料上游：`<workspace>/research/memory-knowledge-seam/experiments/memory-experiment/`

### 随后路线（原优化路线剩余项）

L2 写入富化异步接入（真实条目向 D 臂 88% 靠拢；store.enrich 已有，生产 write 未接）→ 扩展模型对比（若走决策 B 则大部分被吸收）。

### 风险提醒

- 语料 fixture 是 LLM 生成物批次（human C 71%，基准历史抽样 82%）——更换需记录批次并同步断言（fixtures/corpus/README）
- 主模型配置变更会隐性改变扩展路由（速查表新坑行）——改 `agent-default-model` 后必须跑 latency 套件回归

## 4. 即时操作

```sh
# 本地开发
cd dsh-plugins/dsh-knowledge-sqlite
npm test                    # vitest 38 项
node test-smoke.mjs         # SQLite 冒烟（确定性臂数字）
npm run build               # tsc

# 发布（CI 工作流 .github/workflows/publish-knowledge-sqlite.yml，人工审批门）
npm version patch --no-git-tag-version   # 改 package.json + package-lock.json 两处 version
git add -A && git commit -m "release: v0.1.x"
git tag knowledge-sqlite-v0.1.x && git push origin main --tags
# CI 过验证链后停在 GitHub environment 'npm-publish' 审批门；
# 代批：gh api --method POST repos/NinjaSln-labs/dsh-plugins/actions/runs/<run_id>/pending_deployments \
#   --input - <<< '{"environment_ids":[19951219113],"state":"approved","comment":"..."}'

# 宿主部署（发布后）
cd ~/.dsh/profiles/web && pnpm update dsh-knowledge-sqlite
# 重启 dsh web（进程在跑会话本身——用 detached 脚本延时 kill+重启，或让用户手动重启）
```

已知坑（未修/仍会踩）：
- **重启 dsh web = 杀掉当前会话进程**：用 detached 脚本（setsid + sleep 延时 + 同 cwd 重拉），回合结束前调度，页面重载后说「继续」接续
- **patch 配置改动需重启才生效**（bundle 启动时读 config）
- probe 的 `fresh:true` 清两级扩展缓存（内存+SQLite expansion_cache）——评估独立性依赖此语义，别破坏

## 5. 引用索引

| 主题 | 权威位置 |
|---|---|
| 功能与配置 | README.md / README.zh.md |
| V1.11 契约全文 | docs/DESIGN.md |
| 实验与门禁数据 | docs/EXPERIMENTS.md（§5 门禁表 · §6 重测 · §7 诊断 · §8 缓存/timeout · §9 根因链） |
| 评审链 | docs/REVIEWS.md |
| 版本历史 | CHANGELOG.md + git log |
| 测试语料同步规则 | tests/fixtures/corpus/README.md |
| 开发流程与速查表 | ../DEVELOPMENT.md |
| CI 发布工作流 | ../.github/workflows/publish-knowledge-sqlite.yml |
| 宿主 patch 配置 | ~/.dsh/profiles/web/cordis.patch.yml（gating none + queryExpansion.model） |
| 运行数据 | ~/.dsh/knowledge.sqlite（items + expansion_cache 表） |

## 6. 维护规则

- 更新时机：每次迭代收尾（发版/门禁重测/根因结论）更新 §2–§4；稳定知识进引用索引指向的文档，不进本文件
- 防双源：EXPERIMENTS/CHANGELOG/commit 已有的内容只引用；最近完成永远一行式
- 已确认修复的坑迁出正文（DEVELOPMENT.md 速查表是坑的长期家）；待办完成后从 §3 移除
- 脱敏：密钥只写路径；不写 token/key 值
