import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { Plugin } from 'vite'
import { defineConfig } from 'electron-vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import svgr from 'vite-plugin-svgr'

const ALWAYS_EXTERNAL = ['electron', 'bufferutil', 'utf-8-validate', 'node-pty']
const PI_EXTENSION_LOADER_PATH = '@earendil-works/pi-coding-agent/dist/core/extensions/loader.js'
const PI_EXTENSION_IMPORT_META_RESOLVE_LINE =
  'return fileURLToPath(import.meta.resolve(specifier));'
const PI_EXTENSION_BUNDLED_RESOLVE_LINE = 'return specifier;'
const PI_EXTENSION_NODE_ALIAS_BRANCH =
  '...(isBunBinary ? { virtualModules: VIRTUAL_MODULES, tryNative: false } : { alias: getAliases() }),'
const PI_EXTENSION_VIRTUAL_MODULE_BRANCH =
  '...{ virtualModules: VIRTUAL_MODULES, tryNative: false },'
const UNPDF_DIST_PATH = 'unpdf/dist/index.mjs'
const UNPDF_IMPORT_META_RESOLVE_LINE = 'import.meta.resolve("pdfjs-dist/package.json")'
const UNPDF_CJS_RESOLVE_LINE = 'require.resolve("pdfjs-dist/package.json")'
const MCP_CONFIG_WATCH_IGNORES = [
  '**/.mcp.json',
  '**/.agents/mcp.json',
  '**/.pi/mcp.json',
  '**/.openwaggle/agent/mcp.json',
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
  '@earendil-works/pi-tui',
  'jiti',
  '@modelcontextprotocol/sdk',
  '@electron-toolkit/utils',
  'fast-glob',
  'diff',
  'smol-toml',
  'jszip',
  'mammoth',
  'unpdf',
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
function rolldownExternalFixPlugin(): Plugin {
  return {
    name: 'vite:rolldown-external-fix',
    enforce: 'post',
    configResolved(config) {
      const packageJson: unknown = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
      const allDeps = dependencyNamesFromPackageJson(packageJson)
      const externalDeps = allDeps.filter((dependency) =>
        !BUNDLED_DEPS.some(
          (bundledDependency) =>
            dependency === bundledDependency || dependency.startsWith(`${bundledDependency}/`),
        ),
      )
      const external = [...new Set([...ALWAYS_EXTERNAL, ...externalDeps])]

      // Strip RegExp entries from the resolved external array and ensure all
      // deps are present as plain strings (Rolldown only accepts string[]).
      const resolved = config.build.rolldownOptions.external
      const existing = Array.isArray(resolved)
        ? resolved.filter((entry): entry is string => typeof entry === 'string')
        : []
      const merged = [...new Set([...existing, ...external])]

      config.build.rolldownOptions.external = merged
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
    plugins: [piExtensionLoaderBundlePlugin(), unpdfCjsResolvePlugin(), rolldownExternalFixPlugin()],
    build: {
      minify: false,
      externalizeDeps: {
        exclude: BUNDLED_DEPS,
      },
      rolldownOptions: {
        external: ALWAYS_EXTERNAL,
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
    },
    optimizeDeps: {
      // Force re-optimization in dev so Vite does not serve stale prebundled
      // dependency copies after local dependency changes or upgrades.
      force: true,
      include: ['react/compiler-runtime'],
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
      tanstackRouter({
        routesDirectory: resolve('src/renderer/src/routes'),
        generatedRouteTree: resolve('src/renderer/src/routeTree.gen.ts'),
      }),
      svgr(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
      disablePluginTimingWarningsPlugin(),
    ]
  }
})
