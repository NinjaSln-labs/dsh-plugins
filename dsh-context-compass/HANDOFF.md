# HANDOFF.md — dsh-context-compass 工作交接

> 最后更新：2026-08-26 · 交接方：dsh web 会话（ox-alpha）· 一句话：**0.8.0 已发布且本机重启加载、重启验证全过；下一步 R1 sparkline（S2 已就绪）或 C1 host 配置点调研（先调研定稿再动工）**

## 1. 交接元信息

- **日期**：2026-08-25（0.7.17 发版 + 0.8.0 稳定性基建收尾并发版）
- **插件包**：`dsh-context-compass@0.8.0`（npm latest），npm 用户名 `ninjasln`
- **交接原因**：会话切换
- **文档入口链**：`README.md` → `PUBLISHING.md` → `docs/ROADMAP.md`（路线图唯一权威）· `docs/DESIGN.md` · `docs/AUDIT-0.7.11.md`
- **接收方建议**：
  - 先读本文件 §2–§3；路线/待办见 `docs/ROADMAP.md`（单源）
  - **公测阶段 harness 变化快——每次 dsh 版本变化后跑 `node scripts/contract-check.mjs` 升级体检**（基线清单在 ROADMAP 维护规则）
  - 发布前确认 `git rev-parse <tag> == git rev-parse HEAD`（pits 有 0.7.11 旧代码事故）

## 2. 当前状态快照

### 2.1 版本与仓库

| 域 | 状态 |
|---|---|
| git 仓库 | `NinjaSln-labs/dsh-plugins`，`main` 分支 |
| origin 对齐 | **已对齐**（HEAD == tag `context-compass-v0.8.0`） |
| npm latest | **0.8.0**（tag `context-compass-v0.8.0`，commit `b73b47d`） |
| HEAD | `b73b47d`（== tag，发布前已核对） |
| 本机部署 | `~/.dsh/profiles/web` 干净包 **0.8.0** 已装入（bundles 6+1 条目完整；**待 harness 重启生效**，重启后跑 §3.2） |
| harness | 全局 dsh `0.1.1-rc.2`（公测阶段，版本变化快）；**注意**：本机文件系统映射已变为 `/mnt/e/ninjasin-labs/...`（原 `/Users/sin/...` 挂载失效，node_modules 已重装） |
| 发布管道 | `.github/workflows/publish.yml`——tag `context-compass-v*` → 验证链（含 contract 时延断言）→ `npm-publish` 审批 |

### 2.2 功能与质量

| 域 | 状态 |
|---|---|
| 功能 | 0.7.16 全量：徽章 + `/compass` + 工具 + 一览面板（活动列、运行中置顶排序）+ R2 压缩频率 + RPC 路由 |
| 一览面板性能 | 轮询帧 **17-19ms**（stale-while-revalidate 生效），冷启动首帧例外（必真查一次 listSessions） |
| 排序规则 | 运行中置顶 → 组内红→黄→蓝→绿 → 非运行中同梯 → 已加载>冷却 → 新在前（host+client 双侧同规则） |
| 占位/未完成 | 配置点接入（C1/C2）在 ROADMAP 标记「需深入调研与设计」，未动工 |

### 2.3 测试

| 套件 | 结果 |
|---|---|
| release-check | **7 步全绿**（0.8.0 周期 gate，含新增 S2/S3 断言） |
| smoke | 全绿 **100 项**（+11：S2 兼容矩阵/真实 registry 集成/wire 键集合守卫 + S3 每字段配置生效） |
| mount | 全绿 **5 项**（+1：projection.enabled=false 接线开关） |
| contract-check | ✅（RPC 判别器 + overview ≤200ms 时延断言 + 冷启动豁免重试） |
| visual | 6/6（darwin + linux 双平台基线入库） |

### 2.4 最近完成（一行式——详情在 commit message）

- `b73b47d` release v0.8.0
- `509ce94` S2 stateVersion 向后兼容测试 + S3 配置生效冒烟（修 healthView 透传真 bug + 投影双契约兼容）
- `ecd10b4` 文档对齐 0.7.17（ROADMAP 基准 + 根/插件 README 排序与 SWR 口径，中英同步）
- `e431e7b` HANDOFF §3.2 重启验证清单全过
- `d25fabf` HANDOFF 回填（0.7.17 发布 + ui-slots 坑迁归档）
- `822e122` release v0.7.17
- `311cc1f` 补装 @deepseek-ai/dsh-client-ui-slots devDep + linux 视觉基线入库
- 更早（0.7.16 及以前）：已滚动归档至 `HANDOFF-ARCHIVE/cycles.md`

## 3. 下一步与验证点

### 3.1 待发版（0.8.0）——✅ 已完成（2026-08-25）

- [x] push S2/S3 commit
- [x] `npm version minor --no-git-tag-version` → tag `context-compass-v0.8.0`（== HEAD `b73b47d`）→ push → CI 审批发布（npm latest 已确认 0.8.0）
- [x] 发布后 profile 回归干净包：手动改版本 + `pnpm install` + bundles 核对（6 原有条目完整 + 另一会话新增 dsh-session-slm-router）
- [x] **重启后跑 §3.2 清单**——✅ 已完成（2026-08-26，harness 12:16 重启加载 0.8.0）：contract 全绿、SWR 采样 10–16ms、15 会话排序正确；UI 零变更（visual 6/6 已在 0.8.0 构建包上过 gate）

### 3.2 重启验证清单（0.7.17）——✅ 已完成（2026-08-25 晚）

- [x] 一览面板打开秒出列表；运行中会话置顶且组内按缓急排（RPC 实测 running→loaded→cold；GUI 目视确认）
- [x] 「活动」列相对时间显示；数字列表头与数据右对齐（visual 6/6 断言 + GUI 目视确认）
- [x] `/compass` 命令、`context_compass` 工具、badge 浮层正常（client-mount 绿 + visual 6/6 + GUI 目视确认）
- [x] `node scripts/contract-check.mjs` 全绿（overview 13ms；偶发 >200ms 尖峰为 harness 瞬时负载，连续采样 12–16ms）

### 3.3 风险提醒

- **harness 公测阶段 API 快速漂移**——本次 0.1.1 的 wire 契约/coldSnapshot/listSessions 三连坑都是升级暴露（详见 pits）。每次升级先跑 contract-check + 实际看面板数据，别只信 stub 测试
- 改 host 源码后必须完整 `npm run build`（tsc+build-client）再部署/重启；只跑 tsc 的 lib/client.js 是坏的（无 `__ModuleLoader__` 注册）
- peer 保持 `^0.1.0-rc.6` 不随升级升（策略见 ROADMAP 维护规则）；仅接入更高版本独有 API 时局部升

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
4. **新 Linux 环境首次跑 visual**：需 `npx playwright install chromium` + `npx playwright install-deps chromium`（系统库 libnspr4 等）；linux 基线已入库（`311cc1f`），无需再生成

**已修并已归档的坑**（详见 `../../HANDOFF-ARCHIVE/pits.md`）：
- 2026-08-25：node_modules 重装后缺 `@deepseek-ai/dsh-client-ui-slots` 导致 build/typecheck 失败（已入 devDep，commit `311cc1f`）
- 2026-08-22 段：0.1.1 wire 契约 / coldSnapshot 重操作化 / listSessions 抖动 / 时延假阳性 / pnpm add 弄丢 profile bundles 条目 / cp 整目录覆盖坏 client bundle
- 更早：0.7.11 tag 旧代码事故等（见 pits 上方段落）

## 5. 引用索引

| 主题 | 路径 |
|---|---|
| **源码** | `src/`（index / assess / command / config / tool / projection / overview / knowledge / pricing / usage / util / schemas / types / client） |
| **测试与门禁** | `scripts/release-check.mjs`（S0 门禁）· `scripts/contract-check.mjs`（S1 live 契约）· `scripts/smoke.mjs` · `scripts/mount.mjs` · `scripts/client-mount.mjs` · `visual/tests/{badge,panel}.spec.mjs` |
| **设计/路线** | `docs/ROADMAP.md`（唯一权威，含稳定性基建 S0-S4 + 配置点 C1/C2 待调研）· `docs/DESIGN.md` · `docs/OPTIMIZATION-RESEARCH.md` · `docs/RESEARCH-COMPETITORS.md` · `docs/AUDIT-0.7.11.md` |
| **发布记录** | `PUBLISHING.md` |
| **功能文档** | `README.md` + `README.en.md` |
| **决策日志** | `docs/SESSION-LIST-DOT.md` |
| **发布管道** | `../.github/workflows/publish.yml` |
| **归档** | `../../HANDOFF-ARCHIVE/pits.md`（坑）· `cycles.md`（周期 delta） |
| **本机部署** | `~/.dsh/profiles/web/package.json`（改依赖须核对 `dsh.profile.bundles`）· `cordis.patch.yml` |
| **npm** | `https://www.npmjs.com/package/dsh-context-compass` |

## 6. 维护规则

- **更新时机**：版本变化、新坑、待办完成时更新 §2–§4；稳定知识进 README/docs（防双源），本文件只记 delta
- **防双源**——文档已有的引用路径不复制；commit 详情只记一行式 `[hash] 标题`
- **滚动归档**：确认修复的坑迁 `../../HANDOFF-ARCHIVE/pits.md`；旧周期 delta 迁 `cycles.md`
- **脱敏**：不写 token/Key；凭据指向位置不写值
- **发版回填**：§2 快照同步（tag/commit/npm/测试）+ 新坑入 §4 + 已修迁归档
