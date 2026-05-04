import { resolve } from 'path'
import { readFileSync } from 'fs'
import type { Plugin } from 'vite'
import { defineConfig } from 'electron-vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'

const ALWAYS_EXTERNAL = ['electron', 'bufferutil', 'utf-8-validate', 'node-pty']
const PI_EXTENSION_LOADER_PATH = '@mariozechner/pi-coding-agent/dist/core/extensions/loader.js'
const PI_EXTENSION_IMPORT_META_RESOLVE_LINE =
  'return fileURLToPath(import.meta.resolve(specifier));'
const PI_EXTENSION_BUNDLED_RESOLVE_LINE = 'return specifier;'
const PI_EXTENSION_NODE_ALIAS_BRANCH =
  '...(isBunBinary ? { virtualModules: VIRTUAL_MODULES, tryNative: false } : { alias: getAliases() }),'
const PI_EXTENSION_VIRTUAL_MODULE_BRANCH =
  '...{ virtualModules: VIRTUAL_MODULES, tryNative: false },'

const BUNDLED_DEPS = [
  'effect',
  '@effect/platform',
  '@effect/platform-node',
  '@effect/sql',
  '@effect/sql-sqlite-node',
  '@diegogbrisa/ts-match',
  '@mariozechner/pi-coding-agent',
  '@mariozechner/pi-agent-core',
  '@mariozechner/pi-ai',
  '@mariozechner/pi-tui',
  '@mariozechner/jiti',
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

      config.build.rollupOptions.external = merged
    },
  }
}

/**
 * OpenWaggle bundles Pi into the Electron main process. Pi's extension loader
 * normally uses filesystem aliases in Node and virtual modules in bundled Bun
 * binaries. In our bundled CJS output, the Node alias branch would erase
 * `import.meta.resolve` to `{}` and crash when extensions load, so use Pi's
 * bundled virtual-module path for this environment.
 */
function piExtensionLoaderBundlePlugin(): Plugin {
  return {
    name: 'openwaggle:pi-extension-loader-bundle',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes(PI_EXTENSION_LOADER_PATH)) {
        return null
      }

      if (
        !code.includes(PI_EXTENSION_IMPORT_META_RESOLVE_LINE) ||
        !code.includes(PI_EXTENSION_NODE_ALIAS_BRANCH)
      ) {
        throw new Error('Pi extension loader shape changed; update OpenWaggle bundler transform.')
      }

      return code
        .replace(PI_EXTENSION_IMPORT_META_RESOLVE_LINE, PI_EXTENSION_BUNDLED_RESOLVE_LINE)
        .replace(PI_EXTENSION_NODE_ALIAS_BRANCH, PI_EXTENSION_VIRTUAL_MODULE_BRANCH)
    },
  }
}

export default defineConfig({
  main: {
    plugins: [piExtensionLoaderBundlePlugin(), rolldownExternalFixPlugin()],
    build: {
      minify: false,
      externalizeDeps: {
        exclude: BUNDLED_DEPS,
      },
      rollupOptions: {
        external: ALWAYS_EXTERNAL,
        output: {
          inlineDynamicImports: true,
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
      tanstackRouter({
        routesDirectory: resolve('src/renderer/src/routes'),
        generatedRouteTree: resolve('src/renderer/src/routeTree.gen.ts'),
      }),
      svgr(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ]
  }
})
