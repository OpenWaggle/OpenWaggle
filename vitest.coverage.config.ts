import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { ISOLATED_SOURCE_CONTROL_CLI_ENV } from './scripts/vitest-source-control-env'
import {
  COMPONENT_TIER_TIMEOUTS,
  NODE_TIER_TIMEOUTS,
  TEST_TEMPORARY_ROOT_SETUP,
  TEST_TIME_ZONE_ENV,
} from './scripts/test-support/vitest-tier-options'

/**
 * Component tests need a lightweight SVGR replacement because jsdom cannot
 * parse the data URI modules emitted for `*.svg?react` imports.
 */
function svgStubPlugin(): Plugin {
  return {
    name: 'svg-react-stub',
    enforce: 'pre',
    resolveId(source) {
      if (source.endsWith('.svg?react')) return `\0svg-stub:${source}`
      return null
    },
    load(id) {
      if (!id.startsWith('\0svg-stub:')) return null
      return 'import { createElement } from "react"; export default function SvgStub(props) { return createElement("svg", props); }'
    },
  }
}

export default defineConfig({
  plugins: [svgStubPlugin(), react()],
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
    globalSetup: [TEST_TEMPORARY_ROOT_SETUP],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/main/**/*.ts', 'src/renderer/src/**/*.{ts,tsx}', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/**/index.ts',
        'src/**/types.ts',
        'src/renderer/src/main.tsx',
        'src/renderer/src/routeTree.gen.ts',
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
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          // The unit and integration tiers' deadlines, which instrumentation needs even more.
          ...NODE_TIER_TIMEOUTS,
          env: { ...ISOLATED_SOURCE_CONTROL_CLI_ENV, ...TEST_TIME_ZONE_ENV },
          include: ['src/**/*.unit.test.ts', 'src/**/*.integration.test.ts', 'scripts/**/*.unit.test.ts'],
          setupFiles: [
            'scripts/test-support/isolate-user-home.ts',
            'src/main/test-support/isolate-user-mcp-files.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          ...COMPONENT_TIER_TIMEOUTS,
          env: TEST_TIME_ZONE_ENV,
          include: ['src/**/*.component.test.tsx'],
          setupFiles: ['scripts/test-support/isolate-user-home.ts', 'src/renderer/src/test-setup.ts'],
        },
      },
    ],
  },
})
