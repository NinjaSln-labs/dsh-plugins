# 发布清单：dsh-session-health

工程已就绪，构建产物已验证（tsc 标准装饰器转换，host 模块加载 OK）。

## 1. 本地安装验证（发布前）

```sh
cd dsh-session-health && npm run build
# 在 dsh 中挂载（二选一）：
dsh plugin add ./dsh-session-health            # 本地路径安装（dsh plugin add 支持本地目录）
# 或 profile overlay（web profile）：
#   在 profile 的 cordis.patch.yml 加：
#   - insert:
#       - id: session-health
#         name: 'dsh-session-health'
```

验证点：/health 命令输出正常；会话头部出现徽章（绿/黄/红边框 + 圆点）；悬停浮层数据正确。

> 注意：Client 半（徽章）需要浏览器重新加载插件 bundle——安装后重启 dsh 或刷新页面。

## 2. npm 发布

```sh
cd dsh-session-health
npm publish --access public     # 需要 npm 账号；包名 dsh-session-health
```

发布后安装：`dsh plugin add dsh-session-health`

## 3. GitHub 仓库

- 创建 repo（建议同名 `dsh-session-health`），推入工程
- 挂 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic（README 引用官方推荐）
- README 已含：用法、数据口径表、决策模型、设计文档链接

## 4. 文档公开（可选但推荐）

- 设计文档：`research/session-health-plugin/DESIGN.md` → 复制进 repo `docs/DESIGN.md`
- 评审与实验记录：`research/` 下相关文件（signal 对比表：DSH 精确 vs Cursor 估算）

## 5. 已知待办（不阻塞发布）

- 类型文件打磨：构建用 tsc（标准装饰器转换已验证），7 个类型告警为 Context 扩展/插槽类型声明缺口（产物不受影响，.d.ts 后续收紧）
- npm 版 schemastery 缺 `nullable`/`enum`：已用 `z.union([z.const(...)])` 替代（官方 vendor 版 API 更全）
- `session_health` 工具、投影常驻、进程检测（phase 2）
