import { resolve } from 'path'
import { readFileSync } from 'fs'
import type { Plugin } from 'vite'
import { defineConfig } from 'electron-vite'
import { devtools } from '@tanstack/devtools-vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'

const ALWAYS_EXTERNAL = ['electron', 'bufferutil', 'utf-8-validate', 'node-pty']

const BUNDLED_DEPS = [
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
]

/**
 * Vite 8 (Rolldown) only accepts `string[]` for `external`, not RegExp.
 * electron-vite's `externalizeDepsPlugin` and preset plugin both add RegExp
 * patterns to `rollupOptions.external`, which Rolldown silently ignores in
 * SSR mode (`ssr.noExternal: true`). This plugin runs last and replaces the
 * external array with a pure-string list derived from package.json deps.
 */
function rolldownExternalFixPlugin(): Plugin {
  return {
    name: 'vite:rolldown-external-fix',
    enforce: 'post',
    configResolved(config) {
      const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
      const allDeps = Object.keys(pkg.dependencies ?? {})
      const externalDeps = allDeps.filter(d => !BUNDLED_DEPS.some(b => d === b || d.startsWith(b + '/')))
      const external = [...new Set([...ALWAYS_EXTERNAL, ...externalDeps])]

      // Strip RegExp entries from the resolved external array and ensure all
      // deps are present as plain strings (Rolldown only accepts string[]).
      const resolved = config.build.rollupOptions.external
      const existing = Array.isArray(resolved) ? resolved.filter((e): e is string => typeof e === 'string') : []
      const merged = [...new Set([...existing, ...external])]

      // configResolved receives a frozen config, but rollupOptions.external
      // is the value Vite passes to Rolldown — mutating it here is the
      // documented escape hatch for post-resolution fixups.
      ;(config.build.rollupOptions as { external: string[] }).external = merged
    },
  }
}

export default defineConfig({
  main: {
    plugins: [rolldownExternalFixPlugin()],
    build: {
      minify: true,
      externalizeDeps: {
        exclude: BUNDLED_DEPS,
      },
      rollupOptions: {
        external: ALWAYS_EXTERNAL,
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
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ]
  }
})
