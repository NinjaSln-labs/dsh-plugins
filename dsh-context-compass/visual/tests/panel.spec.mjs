/**
 * dsh-context-compass — overview panel visual matrix.
 *
 * The panel is fully data-driven by POST /context-compass-rpc, so mocking
 * that route makes every pixel reproducible: 明/暗主题 × 四档（红黄蓝绿 +
 * 未知）矩阵 + 分页/排序交互 + 固定 5 行高度回归。
 */
import { test, expect } from '@playwright/test'
import { FIVE_TIER_ROWS, SIX_ROW_PAYLOAD, rpcPayload } from '../fixtures/overview.mjs'
import { mockOverview, openOverview, setTheme, settle } from '../helpers.mjs'

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
})

test('panel light: 四档矩阵 + 固定 5 行高度 + 行序', async ({ page }) => {
  await mockOverview(page, rpcPayload(FIVE_TIER_ROWS))
  await openOverview(page)
  await settle(page)
  // 行序：红 → 黄 → 蓝 → 绿 → 未知（host 排序，5 行满一页）。
  const chips = page.locator('.sh-panel-row .sh-sev-chip')
  await expect(chips).toHaveCount(5)
  await expect(chips.nth(0)).toHaveText('尽快收尾')
  await expect(chips.nth(1)).toHaveText('建议收尾')
  await expect(chips.nth(2)).toHaveText('继续留意')
  await expect(chips.nth(3)).toHaveText('放心继续')
  await expect(chips.nth(4)).toHaveText('暂无数据')
  // 状态列覆盖三态：运行中 / 已加载 / 冷却（fixture 行程与 RPC mock 同步）。
  await expect(page.locator('.sh-panel-row').nth(0)).toContainText('运行中')
  await expect(page.locator('.sh-panel-row').nth(1)).toContainText('已加载')
  await expect(page.locator('.sh-panel-row').nth(2)).toContainText('冷却')
  // 固定 5 行高度：列表几何不得随行数变化（41px × 5 + 16px padding）。
  const box = await page.locator('.sh-panel-list').boundingBox()
  expect(Math.round(box.height)).toBe(41 * 5 + 16)
  await expect(page.locator('.sh-panel')).toHaveScreenshot('panel-light.png')
})

test('panel dark: 四档矩阵（暗色主题）', async ({ page }) => {
  await setTheme(page, 'dark')
  await mockOverview(page, rpcPayload(FIVE_TIER_ROWS))
  await openOverview(page)
  await settle(page)
  await expect(page.locator('.sh-panel')).toHaveScreenshot('panel-dark.png')
})

test('panel: 分页 + 时间排序', async ({ page }) => {
  await mockOverview(page, rpcPayload(SIX_ROW_PAYLOAD))
  await openOverview(page)
  await settle(page)
  // 6 行 → 两页；第 2 页只剩「暂无数据」行。
  await expect(page.locator('.sh-panel-row')).toHaveCount(5)
  await page.locator('.sh-pager-btn[aria-label="下一页"]').click()
  await expect(page.locator('.sh-panel-row')).toHaveCount(1)
  await expect(page.locator('.sh-panel-row .sh-sev-chip')).toHaveText('暂无数据')
  // 切「创建」排序：时间最新在前（green2=600, unknown=500, green=400,
  // yellow=300, blue=200）→ 回到第 1 页（changeSort 重置页码）。
  await page.locator('.sh-col-head[aria-label="按创建时间排序"]').click()
  await expect(page.locator('.sh-panel-row')).toHaveCount(5)
  await expect(page.locator('.sh-panel-row .sh-sev-chip').first()).toHaveText('放心继续')
  await expect(page.locator('.sh-panel-row .sh-sev-chip').nth(1)).toHaveText('暂无数据')
  // 再切回严重度排序：红行回到首位。
  await page.locator('.sh-col-head[aria-label="按健康状态排序"]').click()
  await expect(page.locator('.sh-panel-row .sh-sev-chip').first()).toHaveText('尽快收尾')
})

test('panel: Esc 关闭 + 遮罩点击关闭', async ({ page }) => {
  await mockOverview(page, rpcPayload(FIVE_TIER_ROWS))
  await openOverview(page)
  await settle(page)
  await page.keyboard.press('Escape')
  await expect(page.locator('.sh-panel')).toBeHidden()
  await openOverview(page)
  await settle(page)
  await page.locator('.sh-scrim').click({ position: { x: 10, y: 450 } })
  await expect(page.locator('.sh-panel')).toBeHidden()
})
