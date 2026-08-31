# 部署纪律（硬性）

本仓是 DSH 插件集。**凡涉及插件源码（`src/`、`lib/`）改动并部署到 profile 的任务，必须遵守以下规则**，全文见根目录 `DEVELOPMENT.md`「部署纪律：profile 安装」一节：

1. **安装方式按状态统一**：联调中 / 已入库未发版 → `file:` 直装；已发版且主仓 lib == 部署 lib → 才可用 registry `^x.y.z`。改完源码未发版绝不留在 registry 安装上（同版本号不同内容，版本校验失效）。
2. **安装一律走 `dsh plugin --profile web install`**，禁裸 `npm install`（会把 peerDependencies 装进 profile，产生第二套 `@deepseek-ai/*`）。
3. **每次 install / build 后必跑装后自检**：

   ```bash
   pnpm check:deploy            # 全量；或 --pkg dsh-xxx 单查
   ```

   非零退出码 = FAIL，必须修复后才能继续。
4. `file:` 场景禁止手动软链（Node realpath 会脱离宿主 fallback）。
5. `pnpm-workspace.yaml` 的 `overrides` 是防双实例护栏，勿删。

git pre-commit 钩子（`.githooks/pre-commit`）会在提交涉及 `*/lib/` 改动时自动跑此自检；若钩子未生效，先执行 `git config core.hooksPath .githooks`。
