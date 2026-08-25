# HANDOFF.md — dsh-context-compass 工作交接

> 最后更新：2026-08-24 · 交接方：dsh web 会话（ox-alpha）· 一句话：**0.7.16 已发布（npm latest）；dsh 0.1.1 升级连环坑全部修复（wire 契约 / coldSnapshot / listSessions SWR）；一览面板性能重构完成（轮询帧 ≤20ms）+ UI 精修；4 个 commit 待发版（0.7.17）**

## 1. 交接元信息

- **日期**：2026-08-24
- **插件包**：`dsh-context-compass@0.7.16`（npm latest），npm 用户名 `ninjasln`
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
| origin 对齐 | **ahead 3**——`37bde70`(TTL 6s) / `54487d2`(SWR) / `8f546ce`(冷启动豁免) 未推送，等 0.7.17 |
| npm latest | **0.7.16**（tag `context-compass-v0.7.16`，commit `5758680`） |
| HEAD | `8f546ce`（领先 npm 3 个性能修复 commit） |
| 本机部署 | `~/.dsh/profiles/web` 装 npm 0.7.16 + **手工覆盖的 lib/overview.js（含未发布 SWR 修复）**——0.7.17 发版后需回归干净包 |
| harness | 全局 dsh `0.1.1-rc.2`（公测阶段，版本变化快） |
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
| release-check | **7 步全绿**（build/typecheck/smoke/mount/client-mount/**contract**/visual） |
| smoke | 全绿（88 项级，含 compactIntervalRounds / cold-load-off-request-path / running-置顶 断言） |
| contract-check | ✅（RPC 判别器 + overview ≤200ms 时延断言 + 冷启动豁免重试） |
| visual | 6/6（基线已随排版精修更新） |

### 2.4 最近完成（一行式——详情在 commit message）

- `8f546ce` contract-check 冷启动豁免（预热重试）
- `54487d2` listSessions 改 stale-while-revalidate（任何帧不等慢查询）
- `37bde70` listSessions TTL 2.5s→6s（原值小于轮询间隔）
- `5758680` release v0.7.16
- `8e9425a` 运行中组内 severity 排序（黄跑 > 绿跑）
- `890a07f` 排版精修（定宽对齐 + 8px 容器错位修复 + 基线更新）
- `32d6160` 性能+UI 重构（双缓存/活动列/时延断言）
- 更早（0.7.13→0.7.15 周期）：已滚动归档至 `HANDOFF-ARCHIVE/cycles.md`

## 3. 下一步与验证点

### 3.1 待发版（0.7.17）

- [ ] push 3 个未推送 commit（`git push origin main`）
- [ ] `npm version patch --no-git-tag-version` → 手动 tag `context-compass-v0.7.17` → push → CI 审批发布
- [ ] 发布后 profile 回归干净包：**手动编辑** `~/.dsh/profiles/web/package.json` 版本号（勿用 pnpm add——会弄丢 bundles 条目，见 pits）+ `pnpm install` + 核对 bundles 列表

### 3.2 重启验证清单

- [ ] 一览面板打开秒出列表；运行中会话置顶且组内按缓急排
- [ ] 「活动」列相对时间显示；数字列表头与数据右对齐
- [ ] `/compass` 命令、`context_compass` 工具、badge 浮层正常
- [ ] `node scripts/contract-check.mjs` 全绿（3 项含时延）

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

**已修并已归档的坑**（详见 `../../HANDOFF-ARCHIVE/pits.md` 2026-08-22 段）：
- 0.1.1 wire 契约 / coldSnapshot 重操作化 / listSessions 抖动 / 时延假阳性
- pnpm add 弄丢 profile bundles 条目 / cp 整目录覆盖坏 client bundle
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
