/**
 * dsh-context-compass — /compass 富卡片视觉回归.
 *
 * 在真实会话里执行 /compass，对卡片 展开/收起 两种状态做基线
 * （真实评估链路同时是 smoke 之上的一层 e2e）。live 数据区
 * （severity chip、结论、原因、指标值、全文 body）掩码处理。
 *
 * 执行路径用「点击徽章」（remote.commands.execute 直接派发，~100ms 完成）
 * 而非在输入框手输——手输会把文本交给智能体的回合队列，会话忙时会卡在
 * 「运行中」直到回合结束。
 */
import { test, expect } from '@playwright/test'
import { openSession, setTheme, settle } from '../helpers.mjs'

const CARD_MASK_SELECTORS = [
  '.sh-ccard-body',
  '.sh-ccard-mval',
  '.sh-ccard-summary',
  '.sh-ccard-reason',
  '.sh-sev-chip',
  '.sh-ccard-checklist',
]

const cardMasks = page => CARD_MASK_SELECTORS.map(sel => page.locator(sel))

/** 点击徽章派发 /compass，等到最终态（成功卡片带收起钮 / 失败卡片）。 */
async function runCompass(page) {
  await page.locator('.sh-badge').click()
  await expect(page.locator('.sh-ccard-toggle, .sh-ccard[data-error="true"]').first()).toBeVisible({ timeout: 60_000 })
  return page.locator('.sh-ccard').first()
}

test.beforeEach(async ({ page }) => {
  await openSession(page)
})

test('富卡片：展开（默认）→ 收起，浅色主题', async ({ page }) => {
  await setTheme(page, 'light')
  const card = await runCompass(page)
  await settle(page)
  await expect(card).toHaveScreenshot('card-expanded-light.png', { mask: cardMasks(page) })
  await card.locator('.sh-ccard-toggle').click()
  await settle(page)
  await expect(card).toHaveScreenshot('card-collapsed-light.png', { mask: cardMasks(page) })
})

test('富卡片：展开，暗色主题', async ({ page }) => {
  await setTheme(page, 'dark')
  const card = await runCompass(page)
  await settle(page)
  await expect(card).toHaveScreenshot('card-expanded-dark.png', { mask: cardMasks(page) })
})
