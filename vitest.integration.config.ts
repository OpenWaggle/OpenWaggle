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
    include: ['src/**/*.integration.test.ts'],
    // Real-Git integration tests shell out to `git` many times (worktree add, commit,
    // prune). Under the suite's parallel execution those subprocesses contend for CPU
    // and a single test can exceed the 5s default, so they time out on a busy machine
    // while passing in isolation. Give them room; hooks also run git in setup/teardown.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      enabled: false,
    },
  },
})
