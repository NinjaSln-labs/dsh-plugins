# 发布记录：dsh-session-health

**已发布**（GitHub + npm）：`dsh-session-health@0.4.8`（latest），`dsh-knowledge-sqlite@0.1.2`。

## 发布状态（2026-08-14）

| 项 | 状态 |
|---|---|
| npm | ✅ `dsh-session-health@0.4.8`（latest）· `dsh-knowledge-sqlite@0.1.2`（latest） |
| GitHub | ✅ `NinjaSln-labs/dsh-plugins` main，工作树干净 |
| 本地验证 | ✅ profile 从 npm 加载（`^0.4.8` / `^0.1.2`，registry tarball），`dsh web` 运行中，manifest + badge bundle 正常 |
| 双语文档 | ✅ README.md / README.zh.md（集合 + 两个插件） |

## 版本历史

- **0.4.8** — 官方双币峰谷定价（CNY 中文页 / USD 英文页，无汇率换算）；按北京时间忙闲时；客户端按 locale 显示 CNY/USD
- **0.4.7** — 官方 DeepSeek 峰谷定价接入（`pricing/deepseek.json`），CNY/USD 按 locale
- **0.4.6** — 价格可配置 + 定期拉取（`priceSource: auto`，`priceRefreshHours`）
- **0.4.5** — 计费预期显示金额（`cost.inputPricePerM`）
- **0.4.0** — 缓存命中核算、费用预期、交接清单自动化（git 只读探测）
- **0.3.0** — 压缩感知占用显示（contextPressure 合并）、消息数代理阈值
- **0.2.0** — `session_health` 工具、投影驱动 badge、阈值可配置化、进程检测

## 重新安装 / 验证

```sh
dsh plugin add dsh-session-health
# 或 profile package.json：dsh-session-health: ^0.4.8
# 重启 dsh + 浏览器硬刷新
```

验证点：`/health` 输出正常；头部徽章（绿/蓝/黄/红 + 占用百分比）；悬停显示缓存命中率、预计下次输入（剔除缓存命中）、计费预期（¥/$，忙/闲时标注）；点击徽章运行 `/health`。

## 维护要点

- **价格变更**：更新 `pricing/deepseek.json`（同步自 https://api-docs.deepseek.com/quick_start/pricing/，中英双页），同时更新 `updatedAt`
- **客户端 bundle**：改 `src/client.tsx` 后必须 `npm run build`（tsc + esbuild `__ModuleLoader__` 工厂格式）；host 与 client 变更都需要重启 dsh + 刷新浏览器
- **发布流程**：`npm run build && npm run smoke && npm run mount && node scripts/client-mount.mjs` → 提交推送 → `npm publish --access public`（需 bypass-2fa token 或 2FA）
- **安全**：token 用完即吊销
