/**
 * dsh-context-compass — visual-regression helpers.
 *
 * Shared page choreography against the LIVE harness GUI (DSH_WEB_URL):
 * open a materialized session (the header badge only renders for one),
 * switch light/dark theme through Settings, and mock the overview RPC so
 * the panel matrix is deterministic.
 *
 * Selectors: the app's CSS-module class hashes change between builds, so
 * session rows are matched by the stable-ish `sessionRow` substring and the
 * composer by tag (the app has exactly one textarea).
 */
import { expect } from '@playwright/test'

/** Wait for the app shell, then open a real (non-new) session. */
export async function openSession(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  if (await page.locator('.sh-badge').count() > 0) return
  // Session rows: div.sessionRow* — the "new session" row is the SELECTED
  // one; any other row materializes a real session. Titles differ by locale
  // (新会话 / New Session), so the filter covers both.
  const row = page.locator('div[class*="sessionRow"]')
    .filter({ hasNotText: /新会话|New Session/ })
    .first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.click()
  await expect(page.locator('.sh-badge')).toBeVisible({ timeout: 20_000 })
}

/** Idempotent theme switch through Settings → 外观（浅色/深色 | Light/Dark）. */
export async function setTheme(page, theme) {
  const dark = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))
  const wantDark = theme === 'dark'
  if (dark === wantDark) return
  const trigger = page.locator('button:has-text("设置"), button:has-text("Settings")').first()
  await trigger.click()
  const target = page
    .locator(`button:has-text("${wantDark ? '深色' : '浅色'}"), button:has-text("${wantDark ? 'Dark' : 'Light'}")`)
    .first()
  await expect(target).toBeVisible({ timeout: 10_000 })
  await target.click()
  if (wantDark) {
    await page.waitForSelector('body[data-ds-dark-theme]', { timeout: 10_000 })
  } else {
    await page.waitForFunction(() => !document.body.hasAttribute('data-ds-dark-theme'), { timeout: 10_000 })
  }
  // Close the settings panel so it never overlaps the sidebar/panel.
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(300)
}

/** Intercept the overview RPC with a deterministic payload. */
export async function mockOverview(page, payload) {
  await page.route('**/context-compass-rpc', route => {
    if (route.request().method() === 'POST') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      })
    } else {
      void route.continue()
    }
  })
}

/** Open the overview panel through the sidebar-foot action. */
export async function openOverview(page) {
  await page.locator('.sh-fa').first().click()
  await expect(page.locator('.sh-panel')).toBeVisible({ timeout: 10_000 })
}

/** Wait out the .15s entrance animations so screenshots are settled. */
export async function settle(page) {
  await page.waitForTimeout(350)
}
