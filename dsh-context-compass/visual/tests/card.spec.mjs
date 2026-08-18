/**
 * dsh-context-compass — /compass 富卡片视觉回归.
 *
 * 在真实会话里执行 /compass（点击徽章直接派发，~100ms 完成——手输会排队到
 * 智能体回合，会话忙时卡在「运行中」）。视觉基线只取**头部行**：标题/收起钮
 * 固定、chip 与结论掩码、结论长度归一为单行——头部高度跨会话/主题不变。
 * 指标行/原因/清单/正文随会话数据变化（掩码只盖像素不盖几何），展开/收起用
 * 确定性 DOM 断言覆盖（body 显隐 + 钮文案），不做像素基线。
 */
import { test, expect } from '@playwright/test'
import { openSession, setTheme, settle } from '../helpers.mjs'

/** 点击徽章派发 /compass，等到最终态（成功卡片带收起钮 / 失败卡片）。 */
async function runCompass(page) {
  await page.locator('.sh-badge').click()
  await expect(page.locator('.sh-ccard-toggle, .sh-ccard[data-error="true"]').first()).toBeVisible({ timeout: 60_000 })
  return page.locator('.sh-ccard').first()
}

test.beforeEach(async ({ page }) => {
  await openSession(page)
})

/** 头部行几何：归一结论为单行（掩码元素仍占据自然高度，多行 wrap 会漂移）。 */
async function normalizeHead(page) {
  await page.evaluate(() => {
    const s = document.querySelector('.sh-ccard-summary')
    if (s !== null) s.textContent = '结论'
  })
}

test('富卡片：头部基线（浅色）+ 展开/收起 DOM 切换', async ({ page }) => {
  await setTheme(page, 'light')
  const card = await runCompass(page)
  await normalizeHead(page)
  await settle(page)
  await expect(card.locator('.sh-ccard-head')).toHaveScreenshot('card-head-light.png', {
    mask: [card.locator('.sh-sev-chip'), card.locator('.sh-ccard-summary')],
  })
  // 展开（默认）→ 收起 → 再展开：body 显隐 + 钮文案。
  // force click：卡片可能部分在视口外/被滚动容器遮挡，Playwright 的可点击
  // 检查会卡住；toggle 的功能语义（切换 body 显隐）不依赖点击坐标。
  await expect(card.locator('.sh-ccard-body')).toBeVisible()
  await card.locator('.sh-ccard-toggle').click({ force: true })
  await expect(card.locator('.sh-ccard-body')).toBeHidden()
  await expect(card.locator('.sh-ccard-toggle')).toHaveText('展开')
  await card.locator('.sh-ccard-toggle').click({ force: true })
  await expect(card.locator('.sh-ccard-body')).toBeVisible()
})

test('富卡片：头部基线（暗色）', async ({ page }) => {
  await setTheme(page, 'dark')
  const card = await runCompass(page)
  await normalizeHead(page)
  await settle(page)
  await expect(card.locator('.sh-ccard-head')).toHaveScreenshot('card-head-dark.png', {
    mask: [card.locator('.sh-sev-chip'), card.locator('.sh-ccard-summary')],
  })
})
