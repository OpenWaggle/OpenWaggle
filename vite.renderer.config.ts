import { resolve } from 'node:path'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import svgr from 'vite-plugin-svgr'
import { resolveBuildIdentity } from './scripts/build-identity'
import { isolatedTailwindSourcePlugin } from './scripts/vite/isolated-tailwind-source'
import { stylesheetsFirstPlugin } from './scripts/vite/stylesheets-first'

/**
 * The renderer build (ADR 0064): `src/renderer` to `out/renderer`, which the main process serves
 * from its loopback origin; `bun run dev` points the window at this config's dev server instead.
 * The main process is built by `scripts/build-main.ts`, the preload by
 * `scripts/build-electrobun-preload.ts`.
 */

// Bake this build's Build identity (docs/adr/0032) into the bundle so the running app knows its
// channel without disk IO. The same resolver drives packaging and record-build-meta.
const BUILD_IDENTITY = resolveBuildIdentity()
const BUILD_DEFINE = {
  __OW_BUILD_CHANNEL__: JSON.stringify(BUILD_IDENTITY.channel),
  __OW_PRODUCT_NAME__: JSON.stringify(BUILD_IDENTITY.productName),
  __OW_APP_ID__: JSON.stringify(BUILD_IDENTITY.appId),
}
const MCP_CONFIG_WATCH_IGNORES = ['**/.mcp.json', '**/.openwaggle/mcp.json']
const RENDERER_ROOT = resolve('src/renderer')
const RENDERER_OUT_DIR = resolve('out/renderer')

function disablePluginTimingWarningsPlugin() {
  return {
    name: 'openwaggle:disable-plugin-timing-warnings',
    enforce: 'post',
    configResolved(config) {
      const existingChecks = config.build.rolldownOptions.checks ?? {}
      config.build.rolldownOptions.checks = {
        ...existingChecks,
        pluginTimings: false,
      }

      const existingWorkerOptions = config.worker.rolldownOptions
      const existingWorkerChecks = existingWorkerOptions.checks ?? {}
      config.worker.rolldownOptions = {
        ...existingWorkerOptions,
        checks: {
          ...existingWorkerChecks,
          pluginTimings: false,
        },
      }
    },
  } satisfies Plugin
}

export default defineConfig({
  root: RENDERER_ROOT,
  // The page loads its chunks relative to index.html, from the loopback origin or a file.
  base: './',
  envDir: resolve('.'),
  define: BUILD_DEFINE,
  build: {
    outDir: RENDERER_OUT_DIR,
    emptyOutDir: true,
    // Minified, the initial graph is less than half the bytes to read, parse and compile on every
    // launch (B4). Names in error reports are unaffected: OpenWaggle's error classes set `name`
    // explicitly.
    minify: true,
    cssMinify: true,
    // Hidden maps, never packaged, kept with each release.
    sourcemap: 'hidden',
    // The chunk graph scripts/check-syntax-bundle.ts budgets. Not packaged.
    manifest: true,
    rolldownOptions: {
      input: resolve(RENDERER_ROOT, 'index.html'),
      experimental: {
        chunkOptimization: {
          // On, this pass moves every module that each importer of a lazy chunk already loaded
          // into the entry. The eager shell sat in a preloaded shared chunk only while a
          // chat store -> shell import cycle blocked the pass; breaking that cycle folded it into
          // the entry (283 -> 467 KB) with the same initial bytes. Off keeps the entry within
          // its budget; the initial graph budget guards what boot actually loads.
          avoidRedundantChunkLoads: false,
        },
      },
    },
  },
  worker: {
    // Module workers preserve Shiki's per-language dynamic imports. The IIFE
    // default inlines every bundled grammar into one 10+ MiB first-use asset.
    format: 'es',
  },
  server: {
    host: '127.0.0.1',
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
      clientFiles: ['./src/main.tsx', './src/shared/lib/syntax/syntax.worker.ts'],
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
    stylesheetsFirstPlugin(),
  ],
})
