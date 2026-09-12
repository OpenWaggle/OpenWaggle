import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@openwaggle/extension-sdk': resolve('packages/extension-sdk/src/index.ts'),
      '@openwaggle/pi-waggle': resolve('packages/pi-waggle/src'),
      '@openwaggle/waggle-core': resolve('packages/waggle-core/src'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.unit.test.ts',
      'packages/**/*.unit.test.ts',
      'scripts/**/*.unit.test.ts',
      'e2e/support/**/*.unit.test.ts',
    ],
    /*
     * Vitest's 5s default is unrealistic for this suite, not generous. The unit
     * suite spans 365 files whose cumulative import cost is ~576s across workers,
     * so a test that itself does several dynamic imports (the renderer/extension
     * protocol tests each load three modules) can exceed 5s purely waiting on
     * module resolution under parallel load. That produced two timeouts and a
     * non-zero exit while every assertion passed -- verified as contention, not a
     * hang: the same tests pass in isolation and the whole suite is green at a
     * larger deadline.
     *
     * Raised again to 60s for the same reason, this time driven by the commit-policy
     * script tests, which shell out to real `git` repeatedly (~7s each in isolation)
     * and timed out at 15s only when scheduled alongside their sibling file. A
     * timeout is a ceiling, not a wait: healthy tests still finish in seconds, so a
     * generous ceiling removes contention flake at no runtime cost.
     */
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      enabled: false,
    },
  },
})
