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
