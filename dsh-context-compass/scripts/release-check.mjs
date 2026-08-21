/**
 * dsh-context-compass — 本地发布门禁（release gate）。
 *
 * 一条命令收敛完整验证链，全绿才允许打 tag 发布——替代过去手动跑 6 条
 * 散命令（容易漏）。与 CI 的分工：
 * - CI（.github/workflows/publish.yml）跑 stub 级验证：build / typecheck /
 *   smoke / mount / client-mount（mount 与 client-mount 用的是 stub 服务）
 * - 本脚本额外跑 visual（需运行中 harness，CI 装不了浏览器做不了）
 *
 * 每步独立报告并通过/失败汇总；任一失败整体 exit 1（禁止发布）。
 *
 *   node scripts/release-check.mjs
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 顺序执行；build 必须先（smoke/mount/client-mount/visual 都读 lib/）。
// typecheck 不经过 `npm run typecheck`（它带 `|| true` 会吞退出码），
// 直接调 tsc 取真实退出码。
const steps = [
  ['build', 'npx tsc -p tsconfig.build.json && node scripts/build-client.mjs', 'strict tsc + esbuild client bundle'],
  ['typecheck', 'npx tsc -p tsconfig.json --noEmit', '严格类型检查（真实退出码）'],
  ['smoke', 'node scripts/smoke.mjs', '逻辑冒烟（83 项）'],
  ['mount', 'node scripts/mount.mjs', '真实 cordis 挂载'],
  ['client-mount', 'node scripts/client-mount.mjs', '浏览器启动路径'],
  ['visual', 'npx playwright test -c visual/playwright.config.mjs', '视觉回归（需运行中 harness）'],
]

const results = []
console.log('\n=== dsh-context-compass 发布门禁 ===\n')

for (let i = 0; i < steps.length; i++) {
  const [name, cmd, desc] = steps[i]
  console.log(`▶ [${i + 1}/${steps.length}] ${name} — ${desc}`)
  const r = spawnSync(cmd, { cwd: root, shell: true, stdio: 'inherit' })
  results.push({ name, ok: r.status === 0 })
  console.log('')
}

console.log('=== 汇总 ===')
for (const { name, ok } of results) console.log(`${ok ? '✅' : '❌'} ${name}`)
const failed = results.filter(r => !r.ok).length
if (failed === 0) {
  console.log('\n✅ 全部通过 —— 可以打 tag 发布\n')
  process.exit(0)
} else {
  console.log(`\n❌ ${failed} 项失败 —— 禁止发布，修复后重跑\n`)
  process.exit(1)
}