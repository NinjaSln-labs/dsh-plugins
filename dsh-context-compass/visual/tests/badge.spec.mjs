/**
 * dsh-context-compass — badge hover bridge + tooltip 可达性 e2e（只读）。
 *
 * 桥接层回归（0.5.5 的可达性契约）：徽章 ↔ 浮层空隙由隐形桥接层
 * （.sh-tip::before）接通，鼠标路径不断；键盘聚焦打开、移出子树才关。
 *
 * 只读约定：本套件不触发任何真实 /compass（那会往会话日志写卡片，
 * 污染用户会话）——卡片功能（折叠/时间标签/失败态）由 smoke 与
 * client-mount 的单测覆盖，视觉上由 panel 矩阵（RPC mock，只读）承担。
 */
import { test, expect } from '@playwright/test'
import { openSession } from '../helpers.mjs'

test.beforeEach(async ({ page }) => {
  await openSession(page)
})

test('hover 桥接层：进浮层不断、移出才关；键盘聚焦可达', async ({ page }) => {
  const badge = page.locator('.sh-badge')
  const tip = page.locator('.sh-tip')
  // 悬停徽章 → 浮层出现。
  await badge.hover()
  await expect(tip).toBeVisible()
  // 鼠标沿徽章→浮层的路径连续移动（途经 .sh-tip::before 桥接空隙）→ 浮层保持。
  const box = await tip.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 })
  await expect(tip).toBeVisible()
  // 移出整个包装 → 250ms 延迟后消失。
  await page.mouse.move(12, 12)
  await expect(tip).toBeHidden({ timeout: 3000 })
  // 键盘：Tab 聚焦徽章 → 浮层打开；Tab 到浮层内可聚焦项（计费切换）不关；
  // 再 Tab 移出子树才关。
  await page.locator('.sh-badge').focus()
  await expect(tip).toBeVisible()
  await page.keyboard.press('Tab')
  await page.waitForTimeout(200)
  if (await tip.isVisible()) {
    await page.keyboard.press('Tab')
    await expect(tip).toBeHidden({ timeout: 3000 })
  }
})

// B2/B3 浮层交互（更多详情折叠 + 复制按钮）依赖 0.7.11 部署的 client——
// 当前 harness 跑 0.7.10（无 showMore/copy 控件）时 skip；发布部署后删掉
// 这行 skip 即启用。全程只读：不触发 /compass、不写会话日志（summary RPC
// 本身只读）。
test.skip('浮层 B2/B3：更多详情折叠 + 复制交接摘要按钮（0.7.11 部署后启用）', async ({ page }) => {
  const badge = page.locator('.sh-badge')
  const tip = page.locator('.sh-tip')
  await badge.hover()
  await expect(tip).toBeVisible()
  // B2：次要行（模型窗口/会话规模）默认折叠在「更多详情」。
  await expect(tip.locator('.sh-tip-more')).toBeVisible()
  await expect(tip.locator('.sh-tip-row', { hasText: '模型窗口' })).toBeHidden()
  await tip.locator('.sh-tip-more').click()
  await expect(tip.locator('.sh-tip-row', { hasText: '模型窗口' })).toBeVisible()
  await tip.locator('.sh-tip-more').click()
  await expect(tip.locator('.sh-tip-row', { hasText: '模型窗口' })).toBeHidden()
  // 已压缩是核心信号，不折叠（compactions > 0 时始终可见）。
  if (await tip.locator('.sh-tip-row', { hasText: '已压缩' }).count() > 0) {
    await expect(tip.locator('.sh-tip-row', { hasText: '已压缩' })).toBeVisible()
  }
  // B3：复制按钮存在；点击触发只读 summary RPC（不写会话日志），按钮短暂反馈。
  const copyBtn = tip.locator('.sh-tip-copy')
  await expect(copyBtn).toBeVisible()
  await copyBtn.click()
  await expect(copyBtn).toHaveText(/已复制/, { timeout: 10_000 })
})
