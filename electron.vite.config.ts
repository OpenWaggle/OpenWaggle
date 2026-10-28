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
import {
  ALWAYS_EXTERNAL,
  BUNDLED_DEPS,
  isLazyMainExternal,
  rolldownExternalFixPlugin,
} from './scripts/vite/main-externals'
import { mainBootEntryPlugin } from './scripts/vite/main-boot-entry'
import { mainChunkManifestPlugin } from './scripts/vite/main-chunk-manifest'
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

const UNPDF_DIST_PATH = 'unpdf/dist/index.mjs'
const UNPDF_IMPORT_META_RESOLVE_LINE = 'import.meta.resolve("pdfjs-dist/package.json")'
const UNPDF_CJS_RESOLVE_LINE = 'require.resolve("pdfjs-dist/package.json")'
const MCP_CONFIG_WATCH_IGNORES = [
  '**/.mcp.json',
  '**/.openwaggle/mcp.json',
]

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
      mainChunkManifestPlugin(),
    ],
    build: {
      // Minified with names kept: 26.7 -> 15.8 MB for every process to read, and less V8 code cache
      // (A-F6). Function and class names stay (`keepNames`) for logs and libraries that read them;
      // error reports scrub them anyway (src/shared/error-reporting).
      minify: true,
      // Minified stack traces are `index.js:1:<column>`. Hidden maps (no sourceMappingURL) stay out
      // of the app (electron-builder.ts) and are kept as release artifacts, to map field reports.
      sourcemap: 'hidden',
      externalizeDeps: {
        exclude: BUNDLED_DEPS,
      },
      rolldownOptions: {
        external: EAGER_MAIN_EXTERNALS.filter((dependency) => ALWAYS_EXTERNAL.includes(dependency)),
        checks: {
          pluginTimings: false,
        },
        output: {
          // One file on purpose (A-F6, measured October 2026). Split into chunks, the GUI's startup
          // graph was 2.5 MB instead of 15.8 MB, but with V8's compile cache (src/main/boot.ts) one
          // cached file loads faster than the 100-155 chunks each process reads from app.asar:
          // packaged, interleaved, the split was slower at every milestone (GUI bundle load
          // 302 -> 442 ms, Host listening 588 -> 946 ms, session list 2.99 -> 3.87 s). Lazy
          // `__esmMin` initializers already keep each process from evaluating the others' modules.
          codeSplitting: false,
          keepNames: true,
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
      // See the main build: hidden maps, never packaged, kept with each release.
      sourcemap: 'hidden',
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
