import path from 'node:path'
import { build, type Plugin } from 'vite'

/**
 * File name Pi's bundled-Node runtime expects next to the main bundle: with `PI_BUNDLED_NODE`,
 * `getCodemodeWorkerSpecifier()` reads `./codemode-worker.js` relative to the bundle and starts
 * the codemode sandbox worker from an in-memory `data:` URL copy of it.
 */
export const PI_CODEMODE_WORKER_FILE_NAME = 'codemode-worker.js'

/** File name Pi's image resizing starts its worker from, relative to the module that resizes. */
export const PI_IMAGE_RESIZE_WORKER_FILE_NAME = 'image-resize-worker.js'

/** Photon loads its WASM next to its own CJS entry, so it stays an installed dependency. */
export const PI_PHOTON_PACKAGE = '@silvia-odwyer/photon-node'

const PI_CODING_AGENT_DIST = 'node_modules/@earendil-works/pi-coding-agent/dist'

interface PiWorkerBundle {
  readonly entry: string
  readonly fileName: string
  /**
   * The codemode worker runs from a `data:` URL, which accepts only an ES module importing `node:`
   * builtins. The image worker runs from its file beside the CommonJS main bundle.
   */
  readonly format: 'es' | 'cjs'
  readonly external: readonly string[]
}

export const PI_WORKER_BUNDLES: readonly PiWorkerBundle[] = [
  {
    // Pi's own worker entry for bundled builds; it only imports `@earendil-works/pi-codemode/worker`.
    entry: path.resolve(PI_CODING_AGENT_DIST, 'extensions/codemode/worker.js'),
    fileName: PI_CODEMODE_WORKER_FILE_NAME,
    format: 'es',
    external: [],
  },
  {
    entry: path.resolve(PI_CODING_AGENT_DIST, 'utils/image-resize-worker.js'),
    fileName: PI_IMAGE_RESIZE_WORKER_FILE_NAME,
    format: 'cjs',
    external: [PI_PHOTON_PACKAGE],
  },
]

/**
 * Emits Pi's worker entries next to the Electron main bundle.
 *
 * OpenWaggle bundles Pi into one main chunk, so the worker files Pi resolves from
 * `import.meta.url` (pi-codemode's sandbox worker, Pi's image-resize worker) do not exist there.
 * Each is bundled into one self-contained file after every main build. QuickJS's wasm is read
 * from the `quickjs-wasi` dependency and Photon's from `@silvia-odwyer/photon-node`.
 */
export function piWorkerBundlesPlugin(bundles: readonly PiWorkerBundle[] = PI_WORKER_BUNDLES): Plugin {
  let outDir = ''
  return {
    name: 'openwaggle:pi-worker-bundles',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    async writeBundle() {
      for (const bundle of bundles) {
        await build({
          configFile: false,
          logLevel: 'warn',
          ssr: { noExternal: true, target: 'node' },
          build: {
            ssr: bundle.entry,
            outDir,
            emptyOutDir: false,
            copyPublicDir: false,
            minify: false,
            rolldownOptions: {
              external: [...bundle.external],
              output: {
                format: bundle.format,
                entryFileNames: bundle.fileName,
                codeSplitting: false,
              },
            },
          },
        })
      }
    },
  }
}
