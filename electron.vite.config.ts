import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import { devtools } from '@tanstack/devtools-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'
import reactCompiler from 'babel-plugin-react-compiler'

export default defineConfig({
  main: {
    build: {
      minify: true,
      externalizeDeps: {
        exclude: [
          'effect',
          '@effect/platform',
          '@effect/platform-node',
          '@effect/sql',
          '@effect/sql-sqlite-node',
          '@tanstack/ai',
          '@tanstack/ai-anthropic',
          '@tanstack/ai-openai',
          '@tanstack/ai-gemini',
          '@tanstack/ai-grok',
          '@tanstack/ai-openrouter',
          '@tanstack/ai-ollama',
          '@modelcontextprotocol/sdk',
          '@electron-toolkit/utils',
          'fast-glob',
          'diff',
          'smol-toml',
          'jszip',
          'mammoth',
          'unpdf',
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
      // Force re-optimization in dev so Vite does not serve stale prebundled
      // dependency copies after local dependency changes or upgrades.
      force: true,
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
      svgr(),
      react({
        babel: {
          plugins: [reactCompiler],
        },
      }),
      tailwindcss(),
    ]
  }
})
