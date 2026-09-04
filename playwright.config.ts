import { defineConfig } from '@playwright/test'

const CI = process.env.CI === 'true' || process.env.CI === '1'
const TIMEOUT = 90_000
const CI_RETRY_COUNT = 2

const PARSED_WORKERS = Number.parseInt(process.env.PLAYWRIGHT_WORKERS ?? '', 10)
const WORKERS = Number.isNaN(PARSED_WORKERS) || PARSED_WORKERS < 1 ? 1 : PARSED_WORKERS

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
