#!/usr/bin/env bash
# 同步 worktree 构建产物到 dsh 运行时安装目录（唯一部署入口）。
# 用法：
#   scripts/sync-runtime.sh          # 构建 + 同步 lib/ 与 cordis.patch.yml
#   scripts/sync-runtime.sh --no-build   # 跳过构建，仅同步
# 同步后需重启 dsh 生效：kill $(pgrep -f 'dsh web') && nohup dsh web --host 127.0.0.1 --port 3080 --no-open > /tmp/dsh-run.log 2>&1 &
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${HOME}/.dsh/profiles/web/node_modules/dsh-session-slm-router"

if [[ ! -d "$RUNTIME_DIR" ]]; then
  echo "错误：运行时目录不存在：$RUNTIME_DIR" >&2
  exit 1
fi

if [[ "${1:-}" != "--no-build" ]]; then
  echo "▶ 构建..."
  (cd "$PLUGIN_DIR" && npx tsc -p tsconfig.build.json)
fi

echo "▶ 同步 lib/ 与 cordis.patch.yml → $RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR/lib"
cp -f "$PLUGIN_DIR"/lib/*.js "$PLUGIN_DIR"/lib/*.d.ts "$RUNTIME_DIR/lib/"
cp -f "$PLUGIN_DIR/cordis.patch.yml" "$RUNTIME_DIR/"

echo "▶ 校验..."
diff -q "$PLUGIN_DIR/lib/index.js" "$RUNTIME_DIR/lib/index.js" \
  && diff -q "$PLUGIN_DIR/cordis.patch.yml" "$RUNTIME_DIR/cordis.patch.yml" \
  && echo "✅ 同步完成。重启 dsh 后生效。"
