import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { devtools } from '@tanstack/devtools-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import reactCompiler from 'babel-plugin-react-compiler'

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
          '@modelcontextprotocol/sdk',
        ],
      },
      rollupOptions: {
        external: ['bufferutil', 'utf-8-validate', 'node-pty'],
        output: {
          interop: 'auto',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
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
    optimizeDeps: {
      include: ['react/compiler-runtime'],
    },
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
          plugins: [reactCompiler],
        },
      }),
      tailwindcss(),
    ]
  }
})
