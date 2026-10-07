import path from 'node:path'
import { build, type Plugin } from 'vite'

/**
 * File name Pi's bundled-Node runtime expects next to the main bundle: with `PI_BUNDLED_NODE`,
 * `getCodemodeWorkerSpecifier()` reads `./codemode-worker.js` relative to the bundle and starts
 * the codemode sandbox worker from an in-memory `data:` URL copy of it.
 */
export const PI_CODEMODE_WORKER_FILE_NAME = 'codemode-worker.js'

/** Pi's own worker entry for bundled builds; it only imports `@earendil-works/pi-codemode/worker`. */
export const PI_CODEMODE_WORKER_ENTRY = path.resolve(
  'node_modules/@earendil-works/pi-coding-agent/dist/extensions/codemode/worker.js',
)

/**
 * Emits Pi's codemode sandbox worker next to the Electron main bundle.
 *
 * OpenWaggle bundles Pi into one main chunk, so pi-codemode's own `./worker.js` (resolved from
 * `import.meta.url`) does not exist there. Pi's bundled-Node path loads the worker from a `data:`
 * URL, which allows only `node:` imports, so the worker is bundled as one self-contained ES module
 * with QuickJS included. The QuickJS wasm itself is read from the `quickjs-wasi` dependency.
 */
export function piCodemodeWorkerPlugin(entry = PI_CODEMODE_WORKER_ENTRY): Plugin {
  let outDir = ''
  return {
    name: 'openwaggle:pi-codemode-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    async writeBundle() {
      await build({
        configFile: false,
        logLevel: 'warn',
        ssr: { noExternal: true, target: 'node' },
        build: {
          ssr: entry,
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: false,
          rolldownOptions: {
            output: {
              format: 'es',
              entryFileNames: PI_CODEMODE_WORKER_FILE_NAME,
              codeSplitting: false,
            },
          },
        },
      })
    },
  }
}
