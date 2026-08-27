# DSH 插件集

## ⭐ 原创声明

本项目所有插件均为**自研原创开发**，非第三方插件的聚合或转载。

[English](README.en.md) | 简体中文

DeepSeek Harness 个人自研插件合集：上下文罗盘、跨会话知识、子代理模型路由、Cursor 子代理、AI 生图。所有插件均可通过 `dsh plugin add <name>` 安装。

## 插件

| 插件 | 说明 | 状态 |
|---|---|---|
| [dsh&#8209;context&#8209;compass](./dsh-context-compass) | **上下文罗盘 v0.10.0**：<br>· 响应式徽章（投影驱动）+ `/compass` 命令 + `context_compass` 工具<br>· **settings 配置点**（v0.10.0）：阈值/探测开关 live 生效（badge 下一帧即变，无需重启）<br>· 浮层占用趋势 sparkline（最近 ≤40 次请求压力折线）<br>· 多会话上下文总览面板（"罗盘一览"）：运行中置顶排序 · 活动列 · SWR 轮询（帧 ≤20ms）<br>· 官方峰谷双币定价（CNY/USD，jsdelivr 主源 + GitHub raw 回退）<br>· 主题自适应四档配色 · 缓存感知窗口经济档位<br>· 压缩频率提示（已压缩 N 次 · 约每 X 轮一次）<br>· 计费金额/token 切换 · 交接清单自动化 · 交接摘要一键复制<br>· 知识库联动（解耦，可选探测 cross-session 回顾）<br>· 富卡片时间标签 · 浮层分层（摘要/详情） · 代理窗口缩放 | ✅ 已发布（GitHub + npm） |
| [dsh&#8209;knowledge&#8209;sqlite](./dsh-knowledge-sqlite) | **跨会话知识库 v0.1.6**：<br>· `ctx.knowledge` 服务 + `knowledge_*` 工具<br>· SQLite FTS5 trigram 索引 + L1 查询扩展（V1.11 契约）<br>· L1 扩展缓存持久化 · 扩展显式关闭思维链<br>· 零 LLM 写入 · 即时可检索 | ✅ 已发布（GitHub + npm） |
| [dsh&#8209;subagent&#8209;router](./dsh-subagent-router) | **子代理模型路由 v0.3.0**：<br>· `subagent_model`：每次调用可指定 provider/model/max_tokens<br>· 内置 `model: "auto"` 路由策略（锚定父模型 · 任务分档升级 · 失败升档/换路 · 健康感知死锚检测 · 全程可审计）<br>· 路由优先级配置（provider 序 · 档位策略 · 档位候选）——设置页下拉枚举化，无需手填 id<br>· **设置页配置 UI**（6 项 live 配置，保存即实时生效，无需重启）<br>· `subagent_models` 目录工具（含 provider health + 模型派生元数据 cost/speed/contextWindow） | ✅ 已发布（GitHub + npm） |
| [dsh&#8209;subagent&#8209;cursor](./dsh-subagent-cursor) | **Cursor 子代理 v0.0.0**：<br>· 经 `@cursor/sdk` 注册 `ctx.subagents` provider（默认 `cursor`）<br>· one-shot local · summary 优先结果展示 · Profile Bundle<br>· 脚手架阶段（SDK `start()` 尚未实现） | 🚧 脚手架（未发布） |
| [dsh&#8209;imgdraw](./dsh-imgdraw) | **AI 生图 v0.1.0**：<br>· `draw_image` 工具 + 输入框"生图"按钮/弹窗（异步生成 · 四格网格 · 下载/保留/删除）<br>· `/imgdraw` 图片路由 · 历史持久化<br>· 后端：默认免费百炼 wan2.7-image · 可选 SiliconFlow Qwen-Image | 🚧 开发中（bundle 完成 · 未发布） |

## 开发流程（强制）

**所有插件开发必须遵循敏捷迭代流程**：[DEVELOPMENT.md](./DEVELOPMENT.md)

- 用户故事写需求（体验导向）→ 一个功能一个迭代 → DoD 全绿才交付 → 交付即试用 → 回顾沉淀
- 动态插件高频坑速查表见该文档附录（client half 完整性、沙箱禁用全局、契约预检、事件格式等）
