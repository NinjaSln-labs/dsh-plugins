# Changelog

## 0.1.0

- feat: Cursor one-shot subagent provider via `@cursor/sdk` (`create` / `send` / `wait` / `cancel`)
- feat: summary-first parent output (`formatForParent` + task result footer)
- feat: closed-set failure lines `cursor:<stage>/<category>`
- test: fake SDK contract coverage (completed / aborted / error / missing key)
- 回顾：顺利=对齐 `settleRunResult`/`subprocessRunHandle` 与 Claude Code 发布边界后，fake SDK TDD 一次过；坑=`resolveChildCwd` 要求真实目录导致初测用 `/tmp/workspace` 失败、包目录 `pnpm test` 可能 EPERM；是否流程缺陷=否（文档已写清用本地 vitest/tsc bin）
