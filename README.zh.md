# DSH 插件集

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 社区插件合集。所有插件均为公开包，可通过 `dsh plugin add <name>` 安装。

[English](README.md) | [中文](README.zh.md)

## 插件

| 插件 | 包 | 状态 |
|---|---|---|
| [dsh-session-health](./dsh-session-health) | 会话健康 v0.5.8：响应式徽章（投影驱动）、`/health` 命令、`session_health` 工具、官方峰谷双币定价（CNY/USD，jsdelivr 主源 + GitHub raw 回退）、主题自适应四档配色、缓存感知的窗口缩放经济档位、计费金额/token 切换、交接清单自动化 | 已发布（GitHub + npm） |
| [dsh-knowledge-sqlite](./dsh-knowledge-sqlite) | 跨会话知识：`ctx.knowledge` + `knowledge_*` 工具，FTS5 trigram + L1 查询扩展（V1.11 契约） | 已发布（GitHub + npm） |
| [dsh-subagent-router](./dsh-subagent-router) | 子代理模型路由：`subagent_model` 工具（每次调用可指定 provider/model/max_tokens + 内置 `model: "auto"` 路由策略，锚定父模型、任务分档升级、失败升档、全程可审计）+ `subagent_models` 目录工具 | 已发布（GitHub + npm） |

## 约定

- 每个插件一个目录，各自是独立 npm 包（`dsh.bundle` 清单）
- 安装：`dsh plugin add <package-name>`
- 发现：[`dsh-plugin`](https://github.com/topics/dsh-plugin) 主题标签
- 仓库保持脱敏：无本地路径、无密钥、noreply git 邮箱
- README 中英双全：`README.md`（英文）+ `README.zh.md`（中文）

## 开发流程（强制）

**所有插件开发必须遵循敏捷迭代流程**：[DEVELOPMENT.md](./DEVELOPMENT.md)

- 用户故事写需求（体验导向）→ 一个功能一个迭代 → DoD 全绿才交付 → 交付即试用 → 回顾沉淀
- 动态插件高频坑速查表见该文档附录（client half 完整性、沙箱禁用全局、契约预检、事件格式等）
