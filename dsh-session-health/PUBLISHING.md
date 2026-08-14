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

- **0.5.5** — 浮层可达性：徽章↔浮层空隙加隐形桥接层（`.sh-tip::before`，悬停路径不断）+ 250ms 消失延迟（防抖动）+ 键盘聚焦打开（Tab 到徽章即显示，移出子树才关）+ 150ms 入场动画（尊重 prefers-reduced-motion）——修复「浮层难进去、计费预期切换行点不到」
- **0.5.4** — 浮层「计费预期」行可点击切换显示口径：金额（默认，¥/$ 按 locale）↔ 计费当量 token 数（`effectivePerRound`，缓存折扣后）；偏好存 localStorage（`dsh-session-health/costDisplay`）；行内 hover/焦点态 + 键盘可达，底行提示更新
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
