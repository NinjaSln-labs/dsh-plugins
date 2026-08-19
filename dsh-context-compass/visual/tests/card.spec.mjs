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
  const before = await page.locator('.sh-ccard').count()
  await page.locator('.sh-badge').click()
  // 等一张「新」卡稳定：总数 +1 且该卡带 toggle（成功/失败都默认收起）。
  await expect(async () => {
    const n = await page.locator('.sh-ccard').count()
    if (n <= before) throw new Error('no new card yet')
    const card = page.locator('.sh-ccard').nth(n - 1)
    if (await card.locator('.sh-ccard-toggle').count() === 0) throw new Error('new card not settled')
  }).toPass({ timeout: 60_000 })
  const n = await page.locator('.sh-ccard').count()
  return page.locator('.sh-ccard').nth(n - 1)
}

test.beforeEach(async ({ page }) => {
  await openSession(page)
})

/** 头部行几何：归一结论与时间标签为固定单行文本——head 是 flex-wrap，
 * 内容宽度变化会让高度抖动（1px 级 diff）；归一后跨会话/主题稳定。 */
async function normalizeHead(page) {
  await page.evaluate(() => {
    const s = document.querySelector('.sh-ccard-summary')
    if (s !== null) s.textContent = '结论'
    const t = document.querySelector('.sh-ccard-time')
    if (t !== null) t.textContent = 'HH:MM'
  })
}

test('富卡片：头部基线（浅色）+ 展开/收起 DOM 切换', async ({ page }) => {
  await setTheme(page, 'light')
  const card = await runCompass(page)
  await normalizeHead(page)
  await settle(page)
  await expect(card.locator('.sh-ccard-head')).toHaveScreenshot('card-head-light.png', {
    mask: [card.locator('.sh-sev-chip'), card.locator('.sh-ccard-summary'), card.locator('.sh-ccard-time')],
  })
  // 默认收起（v0.7.8）→ 展开 → 再收起：body 显隐 + 钮文案。
  // 卡片可能滚出视口（历史卡多时新卡在对话流底部）：先滚到可见，普通
  // click 走 actionability 真实命中（force 在遮挡时可能点到空处）。
  await expect(card.locator('.sh-ccard-body')).toBeHidden()
  await expect(card.locator('.sh-ccard-toggle')).toHaveText('展开')
  const toggle = card.locator('.sh-ccard-toggle')
  await toggle.scrollIntoViewIfNeeded()
  await toggle.click()
  await expect(card.locator('.sh-ccard-body')).toBeVisible()
  await toggle.click()
  await expect(card.locator('.sh-ccard-body')).toBeHidden()
})

test('富卡片：头部基线（暗色）', async ({ page }) => {
  await setTheme(page, 'dark')
  const card = await runCompass(page)
  await normalizeHead(page)
  await settle(page)
  await expect(card.locator('.sh-ccard-head')).toHaveScreenshot('card-head-dark.png', {
    mask: [card.locator('.sh-sev-chip'), card.locator('.sh-ccard-summary'), card.locator('.sh-ccard-time')],
  })
})
