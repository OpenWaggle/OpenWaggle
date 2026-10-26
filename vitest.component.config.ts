import { resolve } from 'node:path'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import {
  COMPONENT_TIER_TIMEOUTS,
  TEST_TEMPORARY_ROOT_SETUP,
  TEST_TIME_ZONE_ENV,
} from './scripts/test-support/vitest-tier-options'

/**
 * Stub `*.svg?react` imports in jsdom tests — SVGR data-URIs are not
 * parseable by jsdom's `document.createElementNS`, so we return a
 * lightweight React component stub instead.
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
      if (id.startsWith('\0svg-stub:')) {
        return 'import { createElement } from "react"; export default function SvgStub(props) { return createElement("svg", props); }'
      }
      return null
    },
  }
}

export default defineConfig({
  /*
   * The React Compiler runs in the app build, so component tests without it are testing
   * different output than ships. That gap hid a real defect: a component reading rows
   * from a library-owned tree instance that mutates in place had its mapped result
   * memoised by the compiler and rendered zero rows in the app, while the un-compiled
   * test rendered them correctly and passed.
   */
  plugins: [svgStubPlugin(), react(), babel({ presets: [reactCompilerPreset()] })],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@openwaggle/extension-sdk': resolve('packages/extension-sdk/src/index.ts'),
      '@openwaggle/extension-react': resolve('packages/extension-react/src/index.tsx'),
      '@openwaggle/pi-waggle': resolve('packages/pi-waggle/src'),
      '@openwaggle/waggle-core': resolve('packages/waggle-core/src'),
    },
  },
  test: {
    environment: 'jsdom',
    globalSetup: [TEST_TEMPORARY_ROOT_SETUP],
    ...COMPONENT_TIER_TIMEOUTS,
    env: TEST_TIME_ZONE_ENV,
    include: ['src/**/*.component.test.tsx', 'packages/**/*.component.test.tsx'],
    setupFiles: ['scripts/test-support/isolate-user-home.ts', 'src/renderer/src/test-setup.ts'],
    coverage: {
      enabled: false,
    },
  },
})
