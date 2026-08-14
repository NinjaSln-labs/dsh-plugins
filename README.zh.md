# DSH 插件集

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 社区插件合集。所有插件均为公开包，可通过 `dsh plugin add <name>` 安装。

[English](README.md) | [中文](README.zh.md)

## 插件

| 插件 | 包 | 状态 |
|---|---|---|
| [dsh-session-health](./dsh-session-health) | 会话健康 v0.5.6：响应式徽章（投影驱动）、`/health` 命令、`session_health` 工具、官方峰谷双币定价（CNY/USD，jsdelivr 主源 + GitHub raw 回退）、主题自适应四档配色、缓存感知的窗口缩放经济档位、计费金额/token 切换、交接清单自动化 | 已发布（GitHub + npm） |
| [dsh-knowledge-sqlite](./dsh-knowledge-sqlite) | 跨会话知识：`ctx.knowledge` + `knowledge_*` 工具，FTS5 trigram + L1 查询扩展（V1.11 契约） | 已发布（GitHub + npm） |
| [dsh-subagent-model-picker](./dsh-subagent-model-picker) | 子代理自由选模型：`subagent_model` 工具（每次调用可指定 provider/model/max_tokens）+ `subagent_models` 目录工具 | 已发布（GitHub + npm） |

## 约定

- 每个插件一个目录，各自是独立 npm 包（`dsh.bundle` 清单）
- 安装：`dsh plugin add <package-name>`
- 发现：[`dsh-plugin`](https://github.com/topics/dsh-plugin) 主题标签
- 仓库保持脱敏：无本地路径、无密钥、noreply git 邮箱
- README 中英双全：`README.md`（英文）+ `README.zh.md`（中文）
