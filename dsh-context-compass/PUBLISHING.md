# 发布记录：dsh-context-compass

**已发布**（GitHub + npm）：`dsh-context-compass@0.6.0`（latest，**新包名首发** CI run 31942773437；旧名 `dsh-session-health` 已发布 deprecate 指令待网页操作）· `dsh-knowledge-sqlite@0.1.2`（latest）。

## 发布状态（2026-08-16 更新）

| 项 | 状态 |
|---|---|
| npm | ✅ `dsh-context-compass@0.6.0`（latest，CI 自动发布，run 31924069699）· `dsh-knowledge-sqlite@0.1.2`（latest） |
| GitHub | ✅ `NinjaSln-labs/dsh-plugins` main（`523c94e`），tag `context-compass-v0.6.0` |
| 本地验证 | ⏳ 重启 `dsh web` + 硬刷新后验证一览面板（profile 当前为 file: 开发模式，重建自动同步） |
| 双语文档 | ✅ README.md / README.zh.md（含面板节） |

**0.6.0 发布过程修复的两个 CI 坑**（`publish.yml` 首次成功跑通）：
1. `npm ci` 需要 lockfile，但 `package-lock.json` 曾被 `.gitignore` 排除 → 入库（`123168c`）
2. setup-node `cache: npm` 在仓库根探测锁文件，`working-directory` 管不到 action → 显式 `cache-dependency-path: dsh-context-compass/package-lock.json`（`523c94e`）

## 版本历史

- **0.7.8** — **修复 /compass 偶发「执行失败 aborted」+ 卡片默认收起**：
  - **失败根源**：面板点击行的 `openSession` 里 `sessions.open`（冷会话异步加载）与 `commands.execute` 同 tick 触发——execute 的 signal 由 UI 请求生命周期管理，面板 `close()` 组件卸载会 abort 进行中的 execute → assess 中途挂 → 「This operation was aborted」失败卡。修复：execute 移到 `setTimeout`（面板卸载后 600ms 发起，signal 重新生成，规避面板生命周期）；冷会话加载窗口也得到缓冲
  - **卡片默认收起**：`CompassCommandCard` 初始 `expanded=false`——完整报告（pre 正文）默认折叠，头部结论/指标一眼可见；多张卡并排不再整页高度堆叠，需要细节再点「展开」
  - **多卡解释**：每次 /compass 正常只生成 1 张卡；「连着两个」是同一会话历史累积（每次操作都在目标会话留卡）+ 偶发失败卡并排。失败根源修复后不再新增失败卡
  - **client 侧改动，硬刷新生效**；visual 卡片测试适配默认收起（初始 body hidden）

- **0.7.7** — **长文本溢出全量排查（举一反三）**：0.7.6 只修了卡片 metric，系统扫描全部展示层后补三处：
  - `.sh-tip`（浮层）加 `max-width:min(420px, calc(100vw - 24px))`——原来只有 min-width:280 无上限，advice/lag 提示超长会撑出视口
  - `.sh-tip-advice` / `.sh-tip-row .sh-v` 加 `overflow-wrap:anywhere`——长 advice/value 折行不溢出
  - `.sh-row-num`（面板数值格）加 `nowrap + ellipsis + overflow:hidden`——数值格永不撑破固定列宽
  - 已确认安全（无需改）：`.sh-badge`/`.sh-fa`（短文案+overflow:hidden）、`.sh-panel-sub`/`.sh-rowtip`/`.sh-foot-hint`（已有 ellipsis）、`.sh-ccard-body`（pre-wrap+break-word）、`.sh-ccard-head`（flex-wrap）
  - **client 侧改动，硬刷新生效；visual 基线需重验**

- **0.7.6** — **修复富卡片跨会话回顾出框**：回顾 metric 的 value 是整段快照（`context-compass-handoff-snapshot） | severity: …`），`.sh-ccard-metric` 的 `white-space:nowrap` 让它单行撑破卡片。双修：
  - **文案**：probeCrossSession 过滤 `---`/标识行/timestamp，只留语义键值行（severity/recommendation/compacted/…），≤160 字符截断——回顾简短可读
  - **CSS**：`.sh-ccard-metric` 改 `white-space:normal` + value `overflow-wrap:anywhere`——任何长 metric 折行不溢出（防御所有未来长值）
  - **host + client 改动，需重启 + 硬刷新生效**

- **0.7.5** — **修复 knowledge.search 丢 this（跨会话回顾二次修复）**：0.7.4 修好 withInitiator 后实机错误变为「Cannot read properties of undefined (reading 'readCaller')」——`const search = knowledge?.search` 解构后调用丢了 knowledge 服务 this（search 内部用 `this.readCaller()`）。修复：`search.call(knowledge, …)`。smoke 的 knowledge stub 加 this 依赖（内部有 `readCaller` 字段 + 无 this 抛错），与 agents stub 一起构成双重 this-绑定回归保护。**host 侧改动，需重启生效**

- **0.7.4** — **修复 withInitiator 丢 this 导致跨会话回顾恒「检索失败」**：0.7.3 把 `withInitiator` 解构成局部变量直接调用，丢了 agents 服务的 `this`（内部用 `this.activeInitiatorRuns`）→ `runWithInitiator` 抛「Cannot read properties of undefined」→ 每次 /compass 的回顾都走 catch 降级。修复：`withInitiator.call(agents, …)` 保留 this 绑定。smoke 的 agents stub 加 this 依赖（解构调用会在单测里直接抛错），防此 class 回归。实机验证：/kbtest 命令上下文 hits=1 命中快照。**host 侧改动，需重启生效**

- **0.7.3** — **修复跨会话回顾空命中**：实机验证发现 `knowledge.search()` 依赖 `agents.currentInitiator()` 派生调用方身份（workspaceId=cwd），而 `/compass` 命令执行**不在** agent 回合链上 → `readCaller()` 返回 null → search 永远返回空 hits（即使库里已有快照）。修复：probeCrossSession 用 `agents.withInitiator(agent, …)` 包裹 search，为命令执行建立真实 initiator 边界；agent 解析失败则 probe「无法定位 agent 身份」降级。**host 侧改动，需重启生效**

- **0.7.2** — **知识库联动（解耦版，D2）**：不绑定 dsh-knowledge-sqlite（其他用户不一定装），写入不越权（`knowledge` 的写面是内部 `_seedWrite` / 门控工具，插件无正当身份）：
  - `/compass` 报告尾部附**结构化交接快照段**（固定键 `context-compass-handoff-snapshot`：severity/recommendation/compacted/compression_ratio/uncommitted/handoff_ready/timestamp）——纯文本可 grep，任何知识/记忆插件或用户都能摄取
  - **可选探测** `ctx.get('knowledge')`（同 tokenMeter/subprocess 探测降级模式）：挂载则只读 `search()`（`expand:false`）检索历史快照 → 输出「跨会话回顾（上次 severity/交接就绪…）」；未挂载则 probe 一行「知识库未安装，跳过」；检索失败降级不抛错
  - 新增 `src/knowledge.ts`（`buildSnapshotText`/`probeCrossSession`）+ `checks.knowledge.enabled`（默认 true）；smoke 53 项（+4：快照段/absent 降级/命中回顾/失败降级）；实机探针确认本 profile 的 knowledge 已挂载
  - **host 侧改动，需重启 dsh web + 刷新浏览器生效**

- **0.7.1** — **修复一览面板「在线」语义错位**：旧实现把 `sessionQuery.listSessions` 的 `live`（= 会话对象存在于内存 `ctx.sessions`，只要被加载/打开过就常驻）当成「在线」显示并与 tooltip「正在运行（激活）」挂钩——0 轮空会话、早已停用的待命会话都被标成「在线」。**实测**（动态 host 探针）：`agents.list()` 7 个 agent 中仅 2 个 `status='running'`，面板却标 7 个在线。修复后状态列改三态，信号源换成 `agents.get(id)?.status === 'running'`（DHS 侧栏「进行中」同源）：
  - **运行中**（`running`）= 该会话的 Agent 生命周期状态为 `running`（正在处理回回合）
  - **已加载**（`loaded`）= 内存驻留但空闲（旧「在线」的合理部分）
  - **冷却**（`cold`）= 仅持久化
  - RPC 契约 `sessions[].live` → `sessions[].status`；排序层级同档内 运行中 > 已加载 > 冷却（旧排序把 idle 顶到正在运行的上面）；headless 无 `agents` 服务时降级 loaded/cold（绝不误报运行中）。**host + client 改动，需重启 dsh web + 刷新浏览器生效**

- **0.7.0** — **路线图第一波收官三项**（0.6.x 路线图，见 `research/session-health-plugin/DESIGN.md` §8）：
  1. **压缩比例量化**：折叠在 `compaction/end` 捕获压缩前压力，首个后续 usage 样本推出 1 − 压缩后/压缩前（不依赖事件载荷；下降才记，压力不降记 null 不虚报）；投影 wire 新增 `compressionRatio`（schema v8，stateVersion 8）；advice / `/compass` 报告 / 工具信号 / 面板 meta 全部带「快照口径」标注
  2. **压缩后判定滞后标注**：占用条改用压缩感知 `projectedTokens`（下次请求成本），`lagOf` 纯函数检测判定（last-wins 压力）与占用条 ≥5pp 分叉且发生过压缩 → 浮层 warn 色提示「压缩后判定滞后：判定基于压缩前压力（x%），预计下次请求后更新（≈ y%）」
  3. **视觉回归**：`visual/` Playwright 套件（`npm run visual` / `visual:update`）——panel 用 `/context-compass-rpc` mock 全确定性（明/暗 × 红黄蓝绿+未知 × 分页/排序/固定 5 行高度）、富卡片真实评估链路（展开/收起 × 明/暗，live 数据掩码）、徽章 hover 桥接层 + 键盘可达 e2e；基线入库 `visual/baselines/`（需运行中 harness，本地发布前门，不进 CI）；新增 devDeps `@playwright/test` + `playwright`（安装时 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`）
  - **发布前门**：`npm run build && npm run smoke && npm run mount && node scripts/client-mount.mjs && npm run visual`（后一项需 harness 运行中）
  - **host + client 改动，需重启 dsh web（pnpm update 后）+ 刷新浏览器生效**

- **0.6.1** — **`/compass` 富卡片**（`conversation.chat.commandview` key `compass`）：severity chip + 结论/原因 + 指标行 + 真实交接清单 + 可折叠全文；`parseCompassReport` 纯解析（未知格式降级）；运行中/失败降级通用行。**client 侧改动，刷新浏览器生效**

- **0.6.0** — **多会话罗盘一览面板**（0.6.x 路线图第一波第 2 项）：侧栏底部「罗盘一览」按钮（`sidebar.footer.action`，rail 态仅显色点）+ 全屏面板（`shell.overlay`）列出所有会话判定。宿主新增 `src/overview.ts`：`sessionQuery.listSessions` → 在线会话切投影注册表快照、冷会话读 `sessionProjectionCache`（cachedSnapshot → coldSnapshot 兜底）、标题走日志折叠 / `readTitleSnapshots` 批量；`/session-health-rpc`（POST，loopback-only，405/400/403/500 齐全）。客户端行按红→黄→蓝→绿→未知排序（host 排序 + 客户端防御性重排），打开期间 5s 刷新，点击行 `sessions.open` + `remote.commands.execute('/health')`，Esc/遮罩关闭，非纯颜色传达。面板无新配置（始终启用）。**dev 模式**：profile 依赖从 `^0.5.8` 切换为 `file:`（与 imgdraw 一致，重建自动同步）。**host + client 改动，需重启 dsh web + 刷新浏览器生效**
- **0.5.8** — 缓存命中率**单数据源 + 单算法位置**：插件不再自己累计 usage（移除 usageTotals/窗口折叠），徽章客户端读核心 `tokenUsage` 投影 face、`/health`/工具读同一投影的 registry 快照——与输入栏**同一个投影对象**；算法收敛到 `src/usage.ts` 的 `cacheHitRateOf()`（client bundle 与 host lib 共用同一源文件），公式与核心 StatsLine 互相指认。**0.5.7（自带累计）未发布，被本版取代**。**host 侧改动，需重启 dsh web 生效**
- **0.5.7** — 缓存命中率与 **dsh 核心输入栏统计（`tokenUsage`）完全同口径**：会话累计 `cacheRead/(uncachedInput+cacheRead+cacheWrite)`（分母含 cacheWrite），折叠语义与 token-meter 一致（per-(turn,step) 去重替换，绝不双计）；显示舍入统一为 `Math.round`——徽章浮层、`/health`、工具、输入栏四处数值一致（修复「浮层 3% vs 输入栏 93%」）。**未发布，被 0.5.8 取代**
- **0.5.5** — 浮层可达性：徽章↔浮层空隙加隐形桥接层（`.sh-tip::before`，悬停路径不断）+ 250ms 消失延迟（防抖动）+ 键盘聚焦打开（Tab 到徽章即显示，移出子树才关）+ 150ms 入场动画（尊重 prefers-reduced-motion）——修复「浮层难进去、计费预期切换行点不到」
- **0.5.4** — 浮层「计费预期」行可点击切换显示口径：金额（默认，¥/$ 按 locale）↔ 计费当量 token 数（`effectivePerRound`，缓存折扣后）；偏好存 localStorage（`dsh-context-compass/costDisplay`）；行内 hover/焦点态 + 键盘可达，底行提示更新
- **0.5.3** — 浮层档位标签去掉颜色字（「绿（放心继续）」→「放心继续」——颜色由着色 chip 表达）；aria-label 保留颜色字（屏幕阅读器看不到颜色）
- **0.5.2** — 徽章/浮层四档配色重做（跨主题可读）：蓝色不再用静态 `--dsw-static-blue-500`（暗色浮层上仅 ~1.6:1，看不清）；每档位引入 `--sh-accent`（点/边/条）/`--sh-ink`（文字）/`--sh-tint`（底纹）三个主题自适应角色——浅色主题加深、`body[data-ds-dark-theme]` 下提亮（color-mix），明暗两主题文字对比度均 ≥3:1，四色色相保持区分度；悬停底纹改用 color-mix 跟随 alias token
- **0.5.1** — 定价源可达性修复：默认 `cost.priceUrl` 从 GitHub raw 改为 jsdelivr CDN 镜像（raw 在部分网络不可达 → 拉取静默失败 → 金额显示降级为静态 USD，zh 界面不显示 CNY）；新增 `cost.priceFallbackUrl`（默认 GitHub raw），同一刷新周期内自动回退，先成功者胜
- **0.5.0** — 经济维度校准（修复大窗口模型下「15% 占用即黄色」）：经济触发从原始压力 token 改为缓存折扣后的计费当量 `effectivePerRound`（与徽章金额显示一致，消除 cacheWrite 双计）；新增 `thresholds.economyWindowRatio`（默认 0.3），经济门槛 = max(economyTokenFloor, 0.3×窗口)——1M 窗口模型上需 ≥300K 计费当量/轮才由经济维度拉黄；黄档文案按成因区分（容量 vs 经济）；assess 的 severity 与投影单元同口径（同一价格折扣、同一 usage 桶）
- **0.4.8** — 官方双币峰谷定价（CNY 中文页 / USD 英文页，无汇率换算）；按北京时间忙闲时；客户端按 locale 显示 CNY/USD
- **0.4.7** — 官方 DeepSeek 峰谷定价接入（`pricing/deepseek.json`），CNY/USD 按 locale
- **0.4.6** — 价格可配置 + 定期拉取（`priceSource: auto`，`priceRefreshHours`）
- **0.4.5** — 计费预期显示金额（`cost.inputPricePerM`）
- **0.4.0** — 缓存命中核算、费用预期、交接清单自动化（git 只读探测）
- **0.3.0** — 压缩感知占用显示（contextPressure 合并）、消息数代理阈值
- **0.2.0** — `context_compass` 工具、投影驱动 badge、阈值可配置化、进程检测

## 重新安装 / 验证

```sh
dsh plugin add dsh-context-compass
# 或 profile package.json：dsh-context-compass: ^0.4.8
# 重启 dsh + 浏览器硬刷新
```

验证点：`/health` 输出正常；头部徽章（绿/蓝/黄/红 + 占用百分比）；悬停显示缓存命中率、预计下次输入（剔除缓存命中）、计费预期（¥/$，忙/闲时标注）；点击徽章运行 `/health`。

## 维护要点

- **价格变更**：更新 `pricing/deepseek.json`（同步自 https://api-docs.deepseek.com/quick_start/pricing/，中英双页），同时更新 `updatedAt`
- **客户端 bundle**：改 `src/client.tsx` 后必须 `npm run build`（tsc + esbuild `__ModuleLoader__` 工厂格式）；host 与 client 变更都需要重启 dsh + 刷新浏览器
- **发布流程（CI 自动发布 + 人工审批门）**：
  ```sh
  cd dsh-context-compass
  npm version patch -m "chore: release v%s"   # 自动提交 + 打 tag context-compass-vX.Y.Z
  git push && git push --tags                  # CI（.github/workflows/publish.yml）接手：
                                               #   验证链（build/typecheck/smoke/mount/client-mount）
                                               #   → tag 版本一致性守卫 → 等你在 GitHub 批准
                                               #   （environment npm-publish, required reviewers）
                                               #   → npm publish
  ```
  应急手动发布（CI 不可用时）：`npm run build && npm run smoke && npm run mount && node scripts/client-mount.mjs && npm publish --access public`（本机 npm 登录态）
- **一次性配置（CI 首次使用前）**：npm granular access token（仅授权 `dsh-context-compass` 包）→ GitHub secrets `NPM_TOKEN`；GitHub Environments 建 `npm-publish` 并设 Required reviewers（自己）——**token 绝不进聊天/对话**
- **安全**：token 存 GitHub secrets；怀疑泄露时 secrets 一键轮换；workflow 权限最小化（contents: read，token 仅注入 publish 步骤）
