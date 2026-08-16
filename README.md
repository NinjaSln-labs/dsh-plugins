# DSH 插件集（DSH Plugins）

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 社区插件合集，所有插件均为公开 npm 包，可通过 `dsh plugin add <name>` 安装。
Community plugin collection for DeepSeek Harness. All plugins are public npm packages, installable via `dsh plugin add <name>`.

[中文](#中文) | [English](#english)

---

## 中文

### 插件

| 插件 | 说明 | 状态 |
|---|---|---|
| [dsh-session-health](./dsh-session-health) | 会话健康 v0.5.8：响应式徽章（投影驱动）、`/health` 命令、`session_health` 工具、官方峰谷双币定价（CNY/USD，jsdelivr 主源 + GitHub raw 回退）、主题自适应四档配色、缓存感知的窗口缩放经济档位、计费金额/token 切换、交接清单自动化 | 已发布（GitHub + npm） |
| [dsh-knowledge-sqlite](./dsh-knowledge-sqlite) | 跨会话知识：`ctx.knowledge` 服务 + `knowledge_*` 工具，SQLite FTS5 trigram 索引 + L1 查询扩展（V1.11 契约，零 LLM 写入、即时可检索） | 已发布（GitHub + npm） |
| [dsh-subagent-router](./dsh-subagent-router) | 子代理模型路由：`subagent_model` 工具（每次调用可指定 provider/model/max_tokens，内置 `model: "auto"` 路由策略——锚定父模型、任务分档升级、失败升档、全程可审计）+ `subagent_models` 目录工具 | 已发布（GitHub + npm） |
| [dsh-imgdraw](./dsh-imgdraw) | AI 生图 v0.1.0：`draw_image` 工具、输入框"生图"按钮 + 弹窗（异步生成、四格网格、下载/保留/删除）、`/imgdraw` 图片路由、历史持久化；后端默认免费百炼 wan2.7-image，可选 SiliconFlow Qwen-Image | 开发中（bundle 完成 · 未发布） |

### 约定

- 每个插件一个目录，各自是独立 npm 包（`dsh.bundle` 清单）
- 安装：`dsh plugin add <package-name>`
- 发现：[`dsh-plugin`](https://github.com/topics/dsh-plugin) GitHub 主题
- 仓库保持脱敏：无本地路径、无密钥、noreply git 邮箱
- 根 README 中文优先、中英一体（中文在前，英文在后）；插件子目录 README 保持双语双文件（`README.md` 英文 + `README.zh.md` 中文）

### 开发流程（强制）

**所有插件开发必须遵循敏捷迭代流程**：[DEVELOPMENT.md](./DEVELOPMENT.md)

- 用户故事写需求（体验导向）→ 一个功能一个迭代 → DoD 全绿才交付 → 交付即试用 → 回顾沉淀
- 动态插件高频坑速查表见该文档附录（client half 完整性、沙箱禁用全局、契约预检、事件格式等）

---

## English

### Plugins

| Plugin | Package | Status |
|---|---|---|
| [dsh-session-health](./dsh-session-health) | session health v0.5.8: reactive badge (projection-driven), `/health` command, `session_health` tool, official peak/off-peak dual-currency pricing (CNY/USD, jsdelivr + GitHub-raw fallback), theme-adaptive severity palette, cache-aware window-scaled economy tier, money/token cost toggle, automated handoff checklist | published (GitHub + npm) |
| [dsh-knowledge-sqlite](./dsh-knowledge-sqlite) | cross-session knowledge: `ctx.knowledge` service + `knowledge_*` tools, SQLite FTS5 trigram index + L1 query expansion (V1.11 contract, zero-LLM writes, instantly searchable) | published (GitHub + npm) |
| [dsh-subagent-router](./dsh-subagent-router) | model-routed subagent delegation: `subagent_model` tool with per-call provider/model/max_tokens overrides + built-in `model: "auto"` routing policy (anchored to the parent's own model; task-tier upgrades, failure escalation, auditable reason) + `subagent_models` catalog tool | published (GitHub + npm) |
| [dsh-imgdraw](./dsh-imgdraw) | text-to-image v0.1.0: `draw_image` tool, input-bar 生图 button + popup (async generation, 4-grid results, download / keep / delete), `/imgdraw` image route, persisted history; DashScope wan2.7-image free by default, SiliconFlow Qwen-Image optional | in development (bundle done · unpublished) |

### Conventions

- One plugin per directory, each a standalone npm package (`dsh.bundle` manifest)
- Install: `dsh plugin add <package-name>`
- Discover: [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic on this repo
- Keep repos sanitized: no local paths, no secrets, noreply git email
- Root README is Chinese-first and bilingual (Chinese first, English below); per-plugin READMEs keep the two-file pattern (`README.md` English + `README.zh.md` Chinese)

### Development Process (mandatory)

**All plugin development must follow the agile iteration process**: [DEVELOPMENT.md](./DEVELOPMENT.md)

- User stories first (experience-driven) → one feature per iteration → Definition of Done all green before shipping → ship & try immediately → retrospective
- Dynamic-plugin pitfall cheatsheet in the appendix (client-half completeness, sandbox-banned globals, contract preflight, event formats, etc.)
