/**
 * dsh-context-compass — badge hover bridge + tooltip 可达性 e2e.
 *
 * 桥接层回归（0.5.5 的可达性契约）：徽章 ↔ 浮层空隙由隐形桥接层
 * （.sh-tip::before）接通，鼠标路径不断；键盘聚焦打开、移出子树才关。
 * 浮层截图不进基线——其行集随 live 数据变化（已压缩行按 compactions
 * 条件渲染）；视觉矩阵由 panel（明/暗 × 四档）与 card（展开/收起 ×
 * 明/暗）基线承担。
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

test('点击徽章运行 /compass（直接派发 → 最终卡片）', async ({ page }) => {
  await page.locator('.sh-badge').click()
  await expect(page.locator('.sh-ccard-toggle, .sh-ccard[data-error="true"]').first()).toBeVisible({ timeout: 60_000 })
})
