# dsh-imgdraw — DeepSeek Harness 文生图插件

输入框「🎨 生图」按钮 + 弹窗（提示词 / 尺寸 / 数量 / 后端 / 配额 / 异步生成 / 4 格网格 / 下载 / 选定保留 / 删除 / 历史重新生成），并注册模型工具 `draw_image` 与 `/imgdraw/` 图片路由。正式 bundle：重启不丢，随 profile 自动加载。

## 安装

```bash
# 方式一：npm 发布后
dsh plugin add dsh-imgdraw

# 方式二：本地开发（本机 web profile）
cd ~/.dsh/profiles/web
pnpm add dsh-imgdraw@file:/path/to/dsh-plugins/dsh-imgdraw
# 并在 package.json 的 dsh.profile.bundles 列表加入 "dsh-imgdraw"，然后重启 dsh web
```

## 配置（cordis.patch.yml / profile overlay，均可选）

| 字段 | 默认 | 说明 |
|---|---|---|
| `outDir` | `~/.dsh/imgdraw` | 图片输出目录 |
| `keysPath` | `~/.dsh/image-api-keys.json` | API keys JSON（dashscope / siliconflow 字段） |
| `routePrefix` | `/imgdraw` | 图片路由前缀（无尾斜杠） |
| `rpcPath` | `/imgdraw-rpc` | 浏览器 JSON RPC 路由 |
| `keepLatest` | `24` | 每轮清理后保留的最新文件数（选定保留的文件永不清理） |
| `maxCount` | `4` | 单次最大生成数量 |
| `defaultBackend` | `dashscope` | 默认后端：`dashscope`（百炼 wan2.7-image 免费）或 `siliconflow`（Qwen-Image） |
| `dashscopeModel` | `wan2.7-image` | 百炼模型 |
| `siliconflowModel` | `Qwen/Qwen-Image` | SiliconFlow 模型 |

示例：

```yaml
- id: imgdraw
  config:
    keepLatest: 40
    defaultBackend: 'dashscope'
```

## 使用

- **模型工具**：`draw_image`（prompt / count / size / backend / tag）——同步等待生成，返回 `/imgdraw/<文件名>` 列表。
- **浏览器**：输入框左侧「🎨 生图」→ 弹窗填提示词（可一键填入 Sin v10 头像模板）→ 生成 → 4 格网格预览 → 下载 / 保留 / 删除；「最近生成」历史跨重启持久化（`~/.dsh/imgdraw/index.json`）。
- **直链**：`http://127.0.0.1:3080/imgdraw/<文件名>`。

## 后端说明

- **百炼 wan2.7-image（默认）**：DashScope `multimodal-generation/generation` 同步端点（国内域名优先，intl 备用）；免费额度 50 次（2026-11-14 到期），用尽后建议切 qwen-image 系列或 z-image-turbo（见 ROADMAP）。
- **SiliconFlow Qwen-Image**：`images/generations` 端点，依赖账户券/余额。
- keys 文件：`~/.dsh/image-api-keys.json`（`{"dashscope": "sk-...", "siliconflow": "sk-...", ...}`，proxy 字段仅供 Gemini 方案预留）。

## 开发

```bash
pnpm install        # workspace 根（dsh-plugins）
pnpm run build      # tsc → lib/ + esbuild → lib/client.js
pnpm run typecheck  # 严格类型检查
```

已知坑：客户端 RPC 无 harness.handle（bundle 半无此桥），Client→Host 走同源 `/imgdraw-rpc` HTTP；生成必须异步提交 + 轮询（浏览器 fetch 30s 上限）；动态插件重启丢失是 DSH 机制，本包为正式 bundle 不受影响。
