# DSH 插件集（已封版 · 存档）

> **⚠️ 本仓库已于 2026-09 封版（archived）。**
> 所有插件均已迁移为**独立单库**开发与发布，本仓库下的插件目录内容**已过时**，仅作历史存档保留。
> **请勿在本仓库提交任何插件改动**——这里不再有构建、部署、发布流程，任何改动都不会生效。

[English](README.en.md) | 简体中文

## 插件新家（单库索引）

各插件后续的开发、Issue、发版均在各自独立仓库进行：

| 插件 | 独立仓库 | 说明 |
|---|---|---|
| dsh-context-compass（上下文罗盘） | https://github.com/NinjaSln-labs/dsh-context-compass | 上下文占用可视化 + 会话交接 |
| dsh-knowledge-sqlite（跨会话知识库） | https://github.com/NinjaSln-labs/dsh-knowledge-sqlite | SQLite FTS5 跨会话知识检索 |
| dsh-subagent-router（子代理模型路由） | https://github.com/NinjaSln-labs/dsh-subagent-router | 子代理 provider/model 路由 |
| dsh-subagent-cursor（Cursor 子代理） | https://github.com/NinjaSln-labs/dsh-subagent-cursor | 经 @cursor/sdk 注册子代理 provider |
| dsh-imgdraw（AI 生图） | https://github.com/NinjaSln-labs/dsh-imgdraw | draw_image 工具 + 输入框生图 |
| dsh-session-slm-router（SLM 会话路由） | https://github.com/NinjaSln-labs/dsh-session-slm-router | 弱模型灰度路由（实验） |

## 本仓库还剩什么

- `dsh-*/` 各插件目录：**迁移时的历史快照**，内容可能落后于单库最新版本，仅存档
- `pricing/`：历史定价数据源（context-compass 已在单库内自带副本）
- 历史 tag 与 `standalone-*` / `dev/*` 分支：subtree split 切库时的历史锚点，永久保留
- 单库迁移方法论沉淀在生态目录根的 `DSH-PLUGIN-STANDALONE-MIGRATION.md`（不在本仓内，亦未入库）

## 历史安装方式（已过时，仅供旧环境参考）

```bash
dsh plugin add dsh-context-compass    # npm 已发布包，与仓库目录无关
```

安装以 npm 包为准；本仓库目录内容与 npm 发布物不再保持同步。

## 原创声明

本项目所有插件均为**自研原创开发**，非第三方插件的聚合或转载。各插件的原创声明与 LICENSE 以其单库为准。
