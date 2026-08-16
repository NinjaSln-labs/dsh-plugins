/**
 * dsh-context-compass — visual-regression config.
 *
 * Runs against the LIVE harness GUI (DSH_WEB_URL, default
 * http://127.0.0.1:3080): the plugin must be mounted and the web shell
 * reachable. Baselines live in ./baselines (committed); regenerate with
 * `npm run visual:update` after an intentional visual change.
 *
 *   npm run visual          # compare against baselines
 *   npm run visual:update   # write new baselines
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  outputDir: './results',
  snapshotDir: './baselines',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1, // one app, one browser: serialize (theme state is global)
  reporter: [['list']],
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02, // antialiasing/env tolerance; masks carry the dynamic data
      animations: 'disabled',
    },
  },
  use: {
    baseURL: process.env.DSH_WEB_URL || 'http://127.0.0.1:3080',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  },
})
