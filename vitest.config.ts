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
    ...NODE_TIER_TIMEOUTS,
    setupFiles: [
      'scripts/test-support/isolate-user-home.ts',
      'src/main/test-support/isolate-user-mcp-files.ts',
    ],
    env: { ...ISOLATED_SOURCE_CONTROL_CLI_ENV, ...TEST_TIME_ZONE_ENV },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'packages/**/*.test.ts'],
    exclude: ['src/**/*.component.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/main/**/*.ts',
        'src/renderer/src/**/*.ts',
        'src/preload/**/*.ts',
        'src/shared/**/*.ts',
        'packages/**/*.ts',
      ],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/**/types.ts',
        'src/renderer/src/main.tsx',
        'src/main/env.ts',
        'src/shared/types/**',
      ],
      thresholds: {
        lines: 40,
        functions: 35,
        statements: 40,
        branches: 30,
      },
    },
  },
})
