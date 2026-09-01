import { defineConfig } from '@playwright/test'

const TIMEOUT = 90_000

export default defineConfig({
  testDir: './e2e',
  timeout: TIMEOUT,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    headless: true,
    trace: 'on-first-retry',
  },
})
