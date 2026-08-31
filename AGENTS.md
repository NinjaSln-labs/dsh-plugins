# 部署纪律（本插件目录适用，硬性）

全文与事故背景见仓库根 `../DEVELOPMENT.md`「部署纪律：profile 安装」，核心规则：

1. 改了本插件源码（`src/`、`lib/`）未发版 → profile 必须以 `file:` 指向本目录安装，禁止留在 registry 安装（同版本号不同内容，版本校验失效）。
2. 安装一律走 `dsh plugin --profile web install`，禁裸 `npm install`。
3. 每次 install / build 后必跑：`pnpm check:deploy --pkg <本插件名>`（在仓库根执行）。FAIL 必须修复。
4. `file:` 场景禁止手动软链；根 `pnpm-workspace.yaml` 的 `overrides` 勿删。
