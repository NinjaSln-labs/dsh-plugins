# dsh-subagent-cursor

[English](./README.md)

把 Cursor 当作 DeepSeek Harness 子代理（one-shot local `@cursor/sdk`）。设计见 [docs/DESIGN.md](./docs/DESIGN.md)，路线图见 [docs/ROADMAP.md](./docs/ROADMAP.md)。

## 最小启用

在 Profile Bundle / 部署配置中挂上本包，并暴露 tool-subagent 行（工具名可自定）：

```yaml
plugins:
  - package: dsh-subagent-cursor
    config:
      providerName: cursor
      model: composer-2.5
      env:
        CURSOR_API_KEY: ${CURSOR_API_KEY}
  - package: dsh-tool-subagent
    config:
      # 将 tool 绑到 provider「cursor」——具体字段以 harness 版本文档为准
      tools:
        - name: subagent_cursor
          provider: cursor
```

需要本机有效的 `CURSOR_API_KEY`（Cursor Dashboard → Integrations）。单测用 fake SDK，不依赖 Key。

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc -p tsconfig.build.json
```

MIT
