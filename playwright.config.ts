import { defineConfig } from '@playwright/test'

const CI = process.env.CI === 'true' || process.env.CI === '1'
const TIMEOUT = 90_000
const CI_RETRY_COUNT = 2
const DECIMAL_RADIX = 10

export function playwrightWorkerCount(ci: boolean, platform: NodeJS.Platform, configured: string | undefined) {
  // Hidden macOS Electron instances contend for native iframe input and the
  // shared compositor. Keep strict frame-budget measurements on one app at a
  // time; Linux/Windows and explicit local parallel runs retain their setting.
  if (ci && platform === 'darwin') return 1
  const parsed = Number.parseInt(configured ?? '', DECIMAL_RADIX)
  return Number.isNaN(parsed) || parsed < 1 ? 1 : parsed
}

const WORKERS = playwrightWorkerCount(CI, process.platform, process.env.PLAYWRIGHT_WORKERS)

export default defineConfig({
  testDir: './e2e',
  // Support-level lifecycle tests run under Vitest; never execute them inside Playwright workers.
  testIgnore: '**/*.unit.test.ts',
  timeout: TIMEOUT,
  fullyParallel: false,
  workers: WORKERS,
  // A single flaky assertion must not red a whole platform job. CI retries give the
  // trace reporter something to capture; locally a failure should surface immediately.
  retries: CI ? CI_RETRY_COUNT : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    headless: true,
    trace: 'on-first-retry',
  },
})
