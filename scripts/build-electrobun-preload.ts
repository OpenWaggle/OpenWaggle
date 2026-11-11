import { resolve } from 'node:path'
import { build } from 'vite'

/**
 * Builds the Electrobun preload (ADR 0064): `src/preload/index.ts` with the Electrobun transport
 * and error-reporting stand-in in place of the Electron ones, as one classic script that
 * `electrobun-main-window.ts` reads and injects into the app's webview. `electrobun/view` is the
 * Hutch devkit's browser SDK source (`bunx electrobun prepare`), as the main build bundles its main
 * SDK. Electrobun injects preload scripts as text, so the bundle is a self-contained IIFE.
 *
 * Usage: `bun scripts/build-electrobun-preload.ts` writes `out/preload/electrobun.js`.
 */
const ROOT = resolve(import.meta.dirname, '..')
const PRELOAD_ENTRY = resolve(ROOT, 'src/preload/index.ts')
const OUT_DIR = resolve(ROOT, 'out/preload')
const BUNDLE_NAME = 'electrobun'

/** The Electron modules the Electrobun preload replaces, by the specifier preload modules use. */
const SHELL_REPLACEMENTS = [
  {
    find: /^\.\/electron-transport$/u,
    replacement: resolve(ROOT, 'src/preload/electrobun-transport.ts'),
  },
  {
    find: /^\.\/error-reporting-bridge$/u,
    replacement: resolve(ROOT, 'src/preload/electrobun-error-reporting-bridge.ts'),
  },
  { find: /^electrobun\/view$/u, replacement: resolve(ROOT, '.hutch/devkit/api/browser/index.ts') },
]

export async function buildElectrobunPreload() {
  await build({
    configFile: false,
    logLevel: 'warn',
    resolve: {
      alias: [...SHELL_REPLACEMENTS, { find: '@shared', replacement: resolve(ROOT, 'src/shared') }],
    },
    build: {
      outDir: OUT_DIR,
      emptyOutDir: false,
      minify: true,
      target: 'es2022',
      lib: {
        entry: PRELOAD_ENTRY,
        formats: ['iife'],
        name: 'openwaggleElectrobunPreload',
        fileName: () => `${BUNDLE_NAME}.js`,
      },
    },
  })
  return resolve(OUT_DIR, `${BUNDLE_NAME}.js`)
}

if (import.meta.main) {
  const output = await buildElectrobunPreload()
  console.log(`Electrobun preload: ${output}`)
}
