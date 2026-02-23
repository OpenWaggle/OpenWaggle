import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { devtools } from '@tanstack/devtools-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: [
          '@tanstack/ai',
          '@tanstack/ai-anthropic',
          '@tanstack/ai-openai',
          '@tanstack/ai-gemini',
          '@tanstack/ai-grok',
          '@tanstack/ai-openrouter',
          '@tanstack/ai-ollama',
          '@t3-oss/env-core',
        ],
      },
      rollupOptions: {
        external: ['bufferutil', 'utf-8-validate', 'node-pty', 'playwright', 'playwright-core'],
        output: {
          interop: 'auto',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        'condukt-ai': resolve('packages/condukt-ai/src/index.ts'),
        '@openhive/condukt-openhive': resolve('packages/condukt-openhive/src/index.ts'),
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      ...devtools({
        eventBusConfig: {
          enabled: false,
        },
      }),
      react({
        babel: {
          plugins: ['babel-plugin-react-compiler'],
        },
      }),
      tailwindcss(),
    ]
  }
})
