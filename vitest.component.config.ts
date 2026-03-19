import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

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
  plugins: [svgStubPlugin(), react()],
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.component.test.tsx'],
    setupFiles: ['src/renderer/src/test-setup.ts'],
    coverage: {
      enabled: false,
    },
  },
})
