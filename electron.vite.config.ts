import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { Plugin } from 'vite'
import { defineConfig } from 'electron-vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'
import { isolatedTailwindSourcePlugin } from './scripts/vite/isolated-tailwind-source'
import {
  EAGER_MAIN_EXTERNALS,
  lazyExternalRequiresPlugin,
} from './scripts/vite/lazy-external-requires'
import { mainBootEntryPlugin } from './scripts/vite/main-boot-entry'
import { piWorkerBundlesPlugin } from './scripts/vite/pi-worker-bundles'
import { resolveBuildIdentity } from './scripts/build-identity'

// Bake this build's Build identity (docs/adr/0032) into the bundles so the
// running app and the updater know their channel without disk IO. The same
// resolver drives electron-builder packaging and record-build-meta.
const BUILD_IDENTITY = resolveBuildIdentity()
const BUILD_DEFINE = {
  __OW_BUILD_CHANNEL__: JSON.stringify(BUILD_IDENTITY.channel),
  __OW_PRODUCT_NAME__: JSON.stringify(BUILD_IDENTITY.productName),
  __OW_APP_ID__: JSON.stringify(BUILD_IDENTITY.appId),
}

const ALWAYS_EXTERNAL = ['electron', 'bufferutil', 'utf-8-validate', 'node-pty']
const UNPDF_DIST_PATH = 'unpdf/dist/index.mjs'
const UNPDF_IMPORT_META_RESOLVE_LINE = 'import.meta.resolve("pdfjs-dist/package.json")'
const UNPDF_CJS_RESOLVE_LINE = 'require.resolve("pdfjs-dist/package.json")'
const MCP_CONFIG_WATCH_IGNORES = [
  '**/.mcp.json',
  '**/.openwaggle/mcp.json',
]

const BUNDLED_DEPS = [
  'effect',
  '@effect/platform',
  '@effect/platform-node',
  '@effect/sql',
  '@effect/sql-sqlite-node',
  '@diegogbrisa/ts-match',
  '@openwaggle/extension-sdk',
  '@openwaggle/pi-waggle',
  '@openwaggle/waggle-core',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-mcp',
  '@earendil-works/pi-tui',
  'jiti',
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/node',
  '@modelcontextprotocol/server',
  '@modelcontextprotocol/ext-apps',
  'typebox',
  '@electron-toolkit/utils',
  'fast-glob',
  'diff',
  'smol-toml',
  'jszip',
  'mammoth',
  'unpdf',
  // plist 5 is ESM-only (no require/default export condition), so it cannot
  // be externalized into the CJS main bundle; bundle it like the other
  // ESM-only dependencies above.
  'plist',
  // Pure-JS packages made of many small files. As externals, every process resolved, read and
  // compiled each of their files at startup (≈150 ms: startup-main.md, A-F4); bundled, they are
  // part of the main bundle's compile cache and evaluate only when their importer does. Natives,
  // WASM readers and packages that locate files beside themselves stay external.
  'zod',
  'undici',
  'ws',
  'proper-lockfile',
  'ignore',
  'jsonc-parser',
  'remark-parse',
  'unified',
  'yauzl',
  'chokidar',
]

interface UnknownObject {
  readonly [key: string]: unknown
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null
}

function dependencyNamesFromPackageJson(value: unknown) {
  if (!isObject(value) || !isObject(value.dependencies)) {
    return []
  }

  return Object.keys(value.dependencies)
}

/**
 * Vite 8 (Rolldown) only accepts `string[]` for `external`, not RegExp.
 * electron-vite's `externalizeDepsPlugin` and preset plugin both add RegExp
 * patterns to `rolldownOptions.external`, which Rolldown silently ignores in
 * SSR mode (`ssr.noExternal: true`). This plugin runs last and replaces the
 * external array with a pure-string list derived from package.json deps.
 */
function mainExternalPackages() {
  const packageJson: unknown = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
  const allDeps = dependencyNamesFromPackageJson(packageJson)
  const externalDeps = allDeps.filter((dependency) =>
    !BUNDLED_DEPS.some(
      (bundledDependency) =>
        dependency === bundledDependency || dependency.startsWith(`${bundledDependency}/`),
    ),
  )
  return new Set([...ALWAYS_EXTERNAL, ...externalDeps])
}

const MAIN_EXTERNAL_PACKAGES = mainExternalPackages()

/**
 * Externals other than Electron are required where their importer first runs instead of at the
 * top of the main bundle (scripts/vite/lazy-external-requires.ts). They are resolved by that
 * plugin, so they are kept out of Rolldown's own `external` list.
 */
function isLazyMainExternal(packageName: string) {
  return MAIN_EXTERNAL_PACKAGES.has(packageName) && !EAGER_MAIN_EXTERNALS.includes(packageName)
}

function rolldownExternalFixPlugin(): Plugin {
  return {
    name: 'vite:rolldown-external-fix',
    enforce: 'post',
    configResolved(config) {
      const external = [...MAIN_EXTERNAL_PACKAGES].filter(
        (dependency) => !isLazyMainExternal(dependency),
      )

      // Strip RegExp entries from the resolved external array and ensure all
      // deps are present as plain strings (Rolldown only accepts string[]).
      const resolved = config.build.rolldownOptions.external
      const existing = Array.isArray(resolved)
        ? resolved.filter(
            (entry): entry is string => typeof entry === 'string' && !isLazyMainExternal(entry),
          )
        : []
      const merged = [...new Set([...existing, ...external])]

      config.build.rolldownOptions.external = merged
    },
  }
}

/**
 * `unpdf` is bundled into the Electron main CJS output. Its Node defaults use
 * `import.meta.resolve`, which Rolldown correctly warns about for non-ESM
 * output and would otherwise erase to `{}`. Keep the transform scoped to the
 * known package metadata lookup instead of disabling import.meta diagnostics.
 */
function unpdfCjsResolvePlugin(): Plugin {
  return {
    name: 'openwaggle:unpdf-cjs-resolve',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes(UNPDF_DIST_PATH)) {
        return null
      }

      if (!code.includes(UNPDF_IMPORT_META_RESOLVE_LINE)) {
        throw new Error('unpdf bundle shape changed; update OpenWaggle bundler transform.')
      }

      return code.replace(UNPDF_IMPORT_META_RESOLVE_LINE, UNPDF_CJS_RESOLVE_LINE)
    },
  }
}

function disablePluginTimingWarningsPlugin(): Plugin {
  return {
    name: 'openwaggle:disable-plugin-timing-warnings',
    enforce: 'post',
    configResolved(config) {
      const existingChecks = config.build.rolldownOptions.checks ?? {}
      config.build.rolldownOptions.checks = {
        ...existingChecks,
        pluginTimings: false,
      }

      const existingWorkerOptions = config.worker.rolldownOptions ?? {}
      const existingWorkerChecks = existingWorkerOptions.checks ?? {}
      config.worker.rolldownOptions = {
        ...existingWorkerOptions,
        checks: {
          ...existingWorkerChecks,
          pluginTimings: false,
        },
      }
    },
  }
}

export default defineConfig({
  main: {
    define: {
      ...BUILD_DEFINE,
      PI_BUNDLED_NODE: 'true',
    },
    plugins: [
      lazyExternalRequiresPlugin(isLazyMainExternal),
      unpdfCjsResolvePlugin(),
      rolldownExternalFixPlugin(),
      piWorkerBundlesPlugin(),
      mainBootEntryPlugin(),
    ],
    build: {
      minify: false,
      externalizeDeps: {
        exclude: BUNDLED_DEPS,
      },
      rolldownOptions: {
        external: EAGER_MAIN_EXTERNALS.filter((dependency) => ALWAYS_EXTERNAL.includes(dependency)),
        checks: {
          pluginTimings: false,
        },
        output: {
          codeSplitting: false,
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@openwaggle/extension-sdk': resolve('packages/extension-sdk/src/index.ts'),
        '@openwaggle/pi-waggle': resolve('packages/pi-waggle/src'),
        '@openwaggle/waggle-core': resolve('packages/waggle-core/src'),
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@openwaggle/extension-sdk': resolve('packages/extension-sdk/src/index.ts')
      }
    }
  },
  renderer: {
    define: BUILD_DEFINE,
    build: {
      // electron-vite leaves the renderer unminified. Minified, the initial graph is less than
      // half the bytes to read, parse and compile on every launch (B4). Names in error reports
      // are unaffected: OpenWaggle's error classes set `name` explicitly.
      minify: true,
      cssMinify: true,
      // The chunk graph scripts/check-syntax-bundle.ts budgets. Not packaged (electron-builder.ts).
      manifest: true,
    },
    worker: {
      // Module workers preserve Shiki's per-language dynamic imports. The IIFE
      // default inlines every bundled grammar into one 10+ MiB first-use asset.
      format: 'es',
    },
    server: {
      cors: {
        origin: '*',
      },
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
      watch: {
        ignored: MCP_CONFIG_WATCH_IGNORES,
      },
      // Transform the renderer and syntax worker graph while the dev server is
      // starting. Without this warmup, opening the first syntax-eligible file
      // causes Vite to discover Shiki on demand and reload the renderer.
      warmup: {
        clientFiles: [
          './src/main.tsx',
          './src/shared/lib/syntax/syntax.worker.ts',
        ],
      },
    },
    optimizeDeps: {
      // Shiki's WASM engine is imported only by the syntax worker. Include it
      // up front so the first TypeScript file cannot trigger dependency
      // optimization and a renderer reload in the middle of a user action.
      include: ['react/compiler-runtime', 'shiki', 'shiki/wasm'],
    },
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
    plugins: [
      isolatedTailwindSourcePlugin(),
      tanstackRouter({
        routesDirectory: resolve('src/renderer/src/routes'),
        generatedRouteTree: resolve('src/renderer/src/routeTree.gen.ts'),
        autoCodeSplitting: true,
      }),
      svgr(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
      disablePluginTimingWarningsPlugin(),
    ]
  }
})
