# HANDOFF.md — dsh-context-compass 工作交接

> 最后更新：2026-08-27 · 交接方：dsh web 会话（ox-alpha）· 一句话：**0.11.0 已发布且重启验证全过（sparkline/Host 校验/延迟稳态）；下一步 C2 卡片或 OV-5 共享排序**

## 1. 交接元信息

- **日期**：2026-08-27（0.9.0→0.11.0 发布 + AUDIT-0.10.0 审计重构周期）
- **插件包**：`dsh-context-compass@0.11.0`（npm latest），npm 用户名 `ninjasln`
- **交接原因**：会话切换
- **文档入口链**：`README.md` → `PUBLISHING.md` → `docs/ROADMAP.md`（路线图唯一权威）· `docs/DESIGN.md` · `docs/AUDIT-0.10.0.md`（23 发现分级，15 fixed/resolved + 6 recorded）· `docs/C1-SETTINGS-DESIGN.md`
- **接收方建议**：
  - 先读本文件 §2–§3；路线/待办见 `docs/ROADMAP.md`（单源）
  - **公测阶段 harness 变化快——每次 dsh 版本变化后跑 `node scripts/contract-check.mjs` 升级体检**
  - 发布前确认 `git rev-parse <tag> == git rev-parse HEAD`（pits 有 0.7.11 旧代码事故）
  - 本机 `/mnt/e` 非 noexec（实测 exec 正常）；commit-msg hook 曾因 CRLF 失效，已修（LF 入库；仓库 `.gitattributes` 已统一行尾，见 pits 2026-08-26/27）
  - **注意：仓库有多会话并行工作**（subagent-router / knowledge-sqlite 等其它插件活跃提交）；提交前 `git status` 核对只 add 自己的路径
  - **行尾已根治**：仓库根 `.gitattributes` 强制 LF（`40ff448`）——任何平台 checkout/add 都是 LF，CRLF 不会再进仓库（见 pits 2026-08-27）

## 2. 当前状态快照

### 2.1 版本与仓库

| 域 | 状态 |
|---|---|
| git 仓库 | `NinjaSln-labs/dsh-plugins`，`main` 分支 |
| origin 对齐 | **HEAD `878c6e3`（含其它会话的提交：subagent-router 0.2.0 等）；工作区有未提交噪声：4 个 workflow 文件 CRLF 化 + `.githooks/`（其它会话产物，勿提交）** |
| npm latest | **0.11.0**（tag `context-compass-v0.11.0`，commit `30ede78`，== HEAD 已核对） |
| HEAD | `30ede78`（== tag；仓库另有其它插件活跃提交） |
| 本机部署 | `~/.dsh/profiles/web` 干净包 **0.11.0** 已装入（bundles 完整；**待 harness 重启加载**） |
| harness | 全局 dsh `0.1.1-rc.2`；文件系统映射 `/mnt/e/ninjasin-labs/...` |
| 发布管道 | `.github/workflows/publish.yml`（含 S4 canary：prerelease → `--tag next`）+ `canary-promote.yml`（晋级 latest） |

### 2.2 功能与质量

| 域 | 状态 |
|---|---|
| 功能 | 0.10.0 全量：徽章 + `/compass` + 工具 + 一览面板（SWR ≤20ms、运行中置顶、活动列）+ R1 sparkline（stateVersion 10）+ C1 settings 配置点（live 生效）+ R2 压缩频率 + RPC 路由 |
| 代码组织 | **重构后**：测试按域拆 `scripts/tests/*.mjs`（13 模块 + runner）；client 拆 `src/client/{styles,shared,badge,command-card,overview}`；host 核心（assess/projection/overview）稳定未动 |
| 质量 | AUDIT-0.10.0：23 发现 → 15 fixed/resolved + 6 recorded（OV-5 抽共享排序 / OV-6 缓存盲区 / OV-8 summary 鉴权 / OV-9 contract 健壮性 / C1-6 双源 / R1-6 断言收窄） |
| 占位/未完成 | C2 配置卡片（P3）· R3 定价同步 CI · 审计修复批未发版 |

### 2.3 测试

| 套件 | 结果 |
|---|---|
| release-check | **7 步全绿**（本轮门禁，含 AUDIT 新增断言） |
| smoke | 全绿 **~125 项**（分域 13 模块：util/projection/usage/assess/pricing/command/tool/overview/s2/r1/s3/c1 + 审计新用例） |
| mount | 全绿 **8 项**（+C1 接线集成 + C1-4 re-apply 冒烟） |
| client-mount | 全绿（4 slot + parseCompassReport/mergePressure/lagOf 入口断言） |
| contract-check | ✅（RPC 判别器 + overview ≤200ms + 冷启动豁免） |
| visual | 6/6（darwin + linux 基线；client 拆分后不变） |

### 2.4 最近完成（一行式——详情在 commit message）

- `fd7d90d` AUDIT recorded 处置：OV-7 独立 AbortController / OV-10 注释 / 测试洞 3-5 / C1-4 冒烟验证
- `55d116e` client.tsx 模块化拆分（src/client/ 五模块，visual 基线不变）
- `e87b7ca` AUDIT-0.10.0 修复批（P1×4 + P2×6：OV-1~4、C1-1~3、R1-1~3 + 新测试）
- `d3bfcdf`/`3fea699` AUDIT 文档与状态
- 0.9.0/0.10.0 周期（R1 sparkline / C1 settings / S4 canary / smoke 拆分 / 0.7.17 发版等）已滚动归档 `HANDOFF-ARCHIVE/cycles.md`
- 更早（0.7.x 周期）：已在归档

## 3. 下一步与验证点

### 3.1 待办（按序）

- [x] **0.11.0 发版**（2026-08-26）：门禁 7 步全绿 → bump minor → tag `context-compass-v0.11.0`（== HEAD `30ede78`）→ CI 审批发布（npm latest 已确认 0.11.0）
- [x] profile 回归干净包：手动改版本 + `pnpm install` + bundles 核对完整；contract-check 复跑全绿
- [x] **重启后验证**——✅ 已完成（2026-08-27 14:29 重启加载 0.11.0）：contract-check 全绿（稳态 25-38ms，首查 431ms 为预热尖峰）；wire pressureHistory 40 样本正常；Playwright 实测浮层 sparkline 可见（aria「占用趋势（最近 40 个采样）」）；Host 校验未破坏浏览器同源访问
- [ ] C2 client 配置卡片（P3，ROADMAP）——开工前先出简短设计定稿
- [ ] R3 定价同步 CI（P2 低优）
- [ ] AUDIT recorded 项（6 项）按需：OV-5 抽 host/client 共享排序模块是唯一一致性风险点，值得优先

### 3.2 风险提醒

- **harness 公测 API 快速漂移**——每次升级先跑 contract-check + 看面板（0.1.1 三连坑教训）
- **审计修复批未发版**——本地代码领先 npm 3 个 commit 面，勿在旧版上继续开发（若重启加载的是 0.10.0 旧行为）
- 改 host 源码后必须完整 `npm run build`（tsc+build-client），只跑 tsc 的 lib/client.js 是坏的
- peer 保持 `^0.1.0-rc.6` 策略（ROADMAP 维护规则）；dsh-settings 已局部升 `^0.1.0-rc.6`
- **多会话并行**：提交前 `git status` 确认只 add 自己的文件；hook 在 /mnt/e 曾因 CRLF 失效（已修 LF 版入库，但其它会话可能再引入 CRLF 工作区噪声）

## 4. 即时操作

```bash
# 发布门禁（一条命令，全绿才允许打 tag）
npm run release-check        # build+typecheck+smoke+mount+client-mount+contract+visual

# live 契约体检（harness 升级后跑；harness 未运行时 exit 2 SKIP）
npm run contract-check       # RPC 判别器 + overview ≤200ms（含冷启动重试）
```

**已知坑**（未修，仍会踩）：
1. `pnpm peers check` 报缺 peer → 正常（profile peers 经共享层解析）
2. 视觉测试只读不写卡（card.spec 已删）
3. harness 冷启动后第一帧 overview 必慢（listSessions 真查一次）——contract-check 已内置预热重试豁免
4. **新 Linux 环境首次跑 visual**：需 `npx playwright install chromium` + `npx playwright install-deps chromium`；linux 基线已入库无需再生成
5. ~~工作区 CRLF 噪声~~ **已根治（gitattributes 强制 LF，见 pits 2026-08-27）**——Windows 侧 checkout 不再产生假 diff，无需再人工核对行尾
6. **多会话并行提交**：提交前 `git status` 核对只 add 自己的路径（仓库有 subagent-router / knowledge-sqlite / session-slm-router 等其它插件活跃）

**已修并已归档的坑**（详见 `../../HANDOFF-ARCHIVE/pits.md`）：
- 2026-08-26：C1 接线 `as` 强转压掉 thunk 未调用（真 bug，mount 集成测试抓到）· commit-msg hook CRLF 根因（PowerShell 安装产物，非 noexec）
- 2026-08-25：ui-slots devDep · 0.1.1 wire 契约三连坑 · pnpm add 弄丢 bundles 等（见 pits）

## 5. 引用索引

| 主题 | 路径 |
|---|---|
| **源码** | `src/`（index / assess / command / config / tool / projection / overview / knowledge / pricing / usage / util / schemas / types）+ `src/client/`（styles / shared / badge / command-card / overview，入口 `src/client.tsx`） |
| **测试与门禁** | `scripts/release-check.mjs`（S0 门禁）· `scripts/contract-check.mjs`（S1 live 契约）· `scripts/smoke.mjs`（runner）· `scripts/tests/`（13 域模块）· `scripts/mount.mjs` · `scripts/client-mount.mjs` · `visual/tests/{badge,panel}.spec.mjs` |
| **设计/路线/审计** | `docs/ROADMAP.md`（唯一权威）· `docs/DESIGN.md` · `docs/C1-SETTINGS-DESIGN.md` · `docs/AUDIT-0.10.0.md`（本轮审计，23 发现分级 + 6 recorded）· `docs/AUDIT-0.7.11.md` |
| **发布记录** | `PUBLISHING.md`（含 S4 canary 流程） |
| **功能文档** | `README.md` + `README.en.md` |
| **发布管道** | `../.github/workflows/publish.yml` · `canary-promote.yml` |
| **归档** | `../../HANDOFF-ARCHIVE/pits.md`（坑）· `cycles.md`（周期 delta） |
| **本机部署** | `~/.dsh/profiles/web/package.json`（改依赖须核对 `dsh.profile.bundles`）· `~/.dsh/settings.yaml`（settings 文档，file provider） |
| **npm** | `https://www.npmjs.com/package/dsh-context-compass` |

## 6. 维护规则

- **更新时机**：版本变化、新坑、待办完成时更新 §2–§4；稳定知识进 README/docs（防双源），本文件只记 delta
- **防双源**——文档已有的引用路径不复制；commit 详情只记一行式 `[hash] 标题`
- **滚动归档**：确认修复的坑迁 `../../HANDOFF-ARCHIVE/pits.md`；旧周期 delta 迁 `cycles.md`
- **脱敏**：不写 token/Key；凭据指向位置不写值
- **发版回填**：§2 快照同步（tag/commit/npm/测试）+ 新坑入 §4 + 已修迁归档
