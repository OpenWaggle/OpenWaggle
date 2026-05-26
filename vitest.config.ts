import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
      '@openwaggle/pi-waggle': resolve('packages/pi-waggle/src'),
      '@openwaggle/waggle-core': resolve('packages/waggle-core/src'),
    },
  },
  test: {
    environment: 'node',
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
