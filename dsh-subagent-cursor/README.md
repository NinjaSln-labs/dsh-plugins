# dsh-subagent-cursor

[简体中文](./README.zh.md)

Cursor-as-subagent provider for DeepSeek Harness (one-shot local `@cursor/sdk`). See [docs/DESIGN.md](./docs/DESIGN.md) and [docs/ROADMAP.md](./docs/ROADMAP.md).

## Minimal enablement

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
      tools:
        - name: subagent_cursor
          provider: cursor
```

Requires a real `CURSOR_API_KEY` (Cursor Dashboard → Integrations). Unit tests use a fake SDK and do not need a key.

```bash
./node_modules/.bin/vitest run
./node_modules/.bin/tsc -p tsconfig.build.json
```

MIT
