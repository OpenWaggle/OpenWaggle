import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'condukt-ai': resolve('../condukt-ai/src/index.ts'),
    },
  },
})
