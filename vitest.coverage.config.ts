import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

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
      '@openwaggle/pi-waggle': resolve('packages/pi-waggle/src'),
      '@openwaggle/waggle-core': resolve('packages/waggle-core/src'),
    },
  },
  test: {
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
          include: ['src/**/*.unit.test.ts', 'src/**/*.integration.test.ts', 'scripts/**/*.unit.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          environment: 'jsdom',
          include: ['src/**/*.component.test.tsx'],
          setupFiles: ['src/renderer/src/test-setup.ts'],
        },
      },
    ],
  },
})
