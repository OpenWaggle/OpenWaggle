import path from 'node:path'
import { build, type Plugin, type UserConfig } from 'vite'

/** The file package.json `main` names; it loads the main bundle after enabling the compile cache. */
export const MAIN_BOOT_FILE_NAME = 'boot.js'
export const MAIN_BOOT_ENTRY = path.resolve('src/main/boot.ts')
const MAIN_BUNDLE_FILE_NAME = 'index.js'

/**
 * Emits `out/main/boot.js` beside the main bundle after every main build (A-F3). The boot shim
 * is bundled on its own because it must run before the 25 MB main bundle is compiled: it enables
 * V8's compile cache and only then requires `./index.js`. It shares the main build's `define`
 * (Build identity) and `@shared` alias. Builds that do not emit the app's `index.js`, such as the
 * Pi main bundle smoke, get no shim.
 */
export function mainBootEntryPlugin(): Plugin {
  let outDir = ''
  let define: UserConfig['define'] = {}
  let alias: NonNullable<UserConfig['resolve']>['alias'] = []
  return {
    name: 'openwaggle:main-boot-entry',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
      define = config.define
      alias = config.resolve.alias
    },
    async writeBundle(_options, bundle) {
      if (!(MAIN_BUNDLE_FILE_NAME in bundle)) return
      await build({
        configFile: false,
        logLevel: 'warn',
        define,
        resolve: { alias },
        ssr: { noExternal: true, target: 'node' },
        build: {
          ssr: MAIN_BOOT_ENTRY,
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: false,
          rolldownOptions: {
            external: ['electron'],
            output: {
              format: 'cjs',
              entryFileNames: MAIN_BOOT_FILE_NAME,
              codeSplitting: false,
            },
          },
        },
      })
    },
  }
}
