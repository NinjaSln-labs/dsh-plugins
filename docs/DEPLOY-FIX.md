# 【交接说明】dsh-knowledge-sqlite 部署纪律违规修复

> 交付对象：负责 dsh-knowledge-sqlite 开发的会话。本说明自包含，无需其他上下文。
> 出处：dsh-plugins 仓 `DEVELOPMENT.md`「部署纪律：profile 安装（2026-08-31 事故沉淀）」+ `AGENTS.md`（仓库根与本插件目录各一份，先读）。

## 1. 问题定性

`dsh-knowledge-sqlite` 当前在 web profile（`~/.dsh/profiles/web`）中以 **registry `^0.1.6`** 方式安装，但主仓 `dsh-plugins/dsh-knowledge-sqlite/lib` 与部署产物 lib 已有 **2 个文件内容差异**（`lib/index.js`、`lib/store.js`）。

这正是 2026-08-31 已沉淀为部署纪律的事故模式：**同版本号、不同内容**——版本校验完全失效，行为错位极难排查。

按纪律判定：**改了源码未发版 → 不允许停留在 registry 安装上，必须转 `file:` 直装**。

## 2. 证据（可自行复现）

```bash
cd /home/shadow/ninjasin-labs/dsh-ecosystem/dsh-plugins
pnpm check:deploy -- --pkg dsh-knowledge-sqlite
# 预期输出：✗ [FAIL] registry 安装且与本仓 lib 有差异（2 个文件）：M index.js  M store.js

# 差异明细（也可手工核对）：
diff -rq dsh-knowledge-sqlite/lib ~/.dsh/profiles/web/node_modules/dsh-knowledge-sqlite/lib
```

profile 侧现状（`~/.dsh/profiles/web/package.json` 的 dependencies）：

```json
"dsh-knowledge-sqlite": "^0.1.6"
```

## 3. 修复步骤（按顺序执行）

### 第 1 步：确认源码构建是最新的

```bash
cd /home/shadow/ninjasin-labs/dsh-ecosystem/dsh-plugins
pnpm --filter dsh-knowledge-sqlite build
```

### 第 2 步：改 profile 依赖为 file: 直装

编辑 `~/.dsh/profiles/web/package.json`，将

```json
"dsh-knowledge-sqlite": "^0.1.6"
```

改为

```json
"dsh-knowledge-sqlite": "file:/home/shadow/ninjasin-labs/dsh-ecosystem/dsh-plugins/dsh-knowledge-sqlite"
```

### 第 3 步：重装（官方入口，禁裸 npm install）

```bash
dsh plugin --profile web install
```

> 禁止用裸 `npm install`：会把 peerDependencies 装进 profile，产生第二套 `@deepseek-ai/*`（Symbol 错配 unscoped、webserver 400）。
> 禁止手动软链：Node realpath 解析会脱离宿主 fallback，报 `Cannot find package '@deepseek-ai/...'`。

### 第 4 步：装后自检（必跑）

```bash
cd /home/shadow/ninjasin-labs/dsh-ecosystem/dsh-plugins
pnpm check:deploy
```

**验收标准（全部满足）**：
- `dsh-knowledge-sqlite` 一行显示 `✓ [PASS] file: 安装，源码 lib 与部署 lib 一致`
- `@deepseek-ai/*` 一行显示 `✓ [PASS] 仅 cosmokit / schemastery，无宿主核心包阴影`
- 整体退出码 0，无 FAIL

### 第 5 步：功能冒烟

重启/刷新宿主 web 后确认插件功能正常（knowledge 检索可用、无 `Cannot find package` 报错、宿主日志无 command/done error）。

## 4. 边界与注意事项

- **如果 lib 差异来自未提交的源码改动**：先评估这些改动——该入库的入库提交（提交涉及 `dsh-knowledge-sqlite/src/` 时 pre-commit 钩子会自动跑 check:deploy，转 file: 后即可通过），不该保留的还原。不要为了绕过 FAIL 而丢弃改动。
- **如果走发版路线替代**（可选）：也可以发新版后走「发版 → 立即重装 registry」闭环再保留 registry 安装；但只要主仓 lib 与部署 lib 存在差异且未发版，`pnpm check:deploy` 会持续 FAIL。二选一即可，联调期推荐 file:。
- profile 里其余插件（context-compass / imgdraw / subagent-router / session-slm-router）当前均为 file: 且 PASS，**不要顺手动它们**。
- 完成后无需回写 dsh-plugins 仓（本说明对应的纪律文档已入库，`DEVELOPMENT.md` 无需再改）；若修复中发现新坑，按纪律「新坑先补速查表再修码」。

## 5. 一句话总结

把 `~/.dsh/profiles/web/package.json` 里 `dsh-knowledge-sqlite` 从 `^0.1.6` 改为 `file:` 指向主仓目录 → `dsh plugin --profile web install` → `pnpm check:deploy` 全绿即完成。
