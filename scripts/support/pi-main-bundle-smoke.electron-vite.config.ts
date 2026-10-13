import path from 'node:path'
import { defineConfig } from 'electron-vite'
import appConfig from '../../electron.vite.config'

export const PI_MAIN_BUNDLE_SMOKE_OUT_DIR = path.resolve('out/pi-main-bundle-smoke')

const main = appConfig.main
if (!main || typeof main !== 'object') throw new Error('electron.vite.config.ts has no main config.')

/** OpenWaggle's Electron main build, unchanged except for its entry and output directory. */
export default defineConfig({
  main: {
    ...main,
    build: {
      ...main.build,
      outDir: PI_MAIN_BUNDLE_SMOKE_OUT_DIR,
      emptyOutDir: true,
      lib: { entry: path.resolve('scripts/support/pi-main-bundle-smoke-entry.ts') },
    },
  },
})
