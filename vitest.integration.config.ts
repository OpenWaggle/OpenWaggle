import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { ISOLATED_SOURCE_CONTROL_CLI_ENV } from './scripts/vitest-source-control-env'
import {
  BUN_RUNTIME_ALIASES,
  NODE_TIER_TIMEOUTS,
  TEST_REPORTERS,
  TEST_TEMPORARY_ROOT_SETUP,
  TEST_TIME_ZONE_ENV,
} from './scripts/test-support/vitest-tier-options'

export default defineConfig({
  resolve: {
    alias: {
      ...BUN_RUNTIME_ALIASES,
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@openwaggle/extension-sdk': resolve('packages/extension-sdk/src'),
      '@openwaggle/pi-waggle': resolve('packages/pi-waggle/src'),
      '@openwaggle/waggle-core': resolve('packages/waggle-core/src'),
    },
  },
  test: {
    reporters: TEST_REPORTERS,
    environment: 'node',
    globalSetup: [TEST_TEMPORARY_ROOT_SETUP],
    setupFiles: [
      'scripts/test-support/isolate-user-home.ts',
      'src/main/test-support/isolate-user-mcp-files.ts',
    ],
    env: { ...ISOLATED_SOURCE_CONTROL_CLI_ENV, ...TEST_TIME_ZONE_ENV },
    include: ['src/**/*.integration.test.ts', 'scripts/**/*.integration.test.ts'],
    ...NODE_TIER_TIMEOUTS,
    coverage: {
      enabled: false,
    },
  },
})
