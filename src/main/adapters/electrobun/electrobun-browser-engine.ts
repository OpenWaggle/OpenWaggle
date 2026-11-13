import { execFile } from 'node:child_process'
import path from 'node:path'
import { CEF_FRAMEWORK_BINARY } from './cef-component/cef-component-files'
import { createCefComponentEngine } from './cef-component/cef-component-engine'
import { decodeCefComponentManifest } from './cef-component/cef-component-manifest'
import manifest from './cef-component/manifest.json'
import { electrobun } from './electrobun-sdk'
import { appPaths } from '../../desktop-shell/app-paths'
import { networkFetch } from '../../desktop-shell/network-fetch'
import { getSafeChildEnv } from '../../env'
import type { BrowserEngineShape } from '../../ports/desktop-shell/browser-engine'

/** macOS's bsdtar, which keeps the extended attributes code signatures live in. */
const SYSTEM_TAR = '/usr/bin/tar'
const COMPONENTS_DIRECTORY = 'cef'
const TAR_OUTPUT_BYTES = 1_048_576

function extractTarXz(archive: string, destination: string) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      SYSTEM_TAR,
      ['-xJf', archive, '-C', destination],
      { env: getSafeChildEnv(), maxBuffer: TAR_OUTPUT_BYTES },
      (error, _stdout, stderr) => {
        if (error === null) resolve()
        else reject(new Error(stderr.trim() || error.message, { cause: error }))
      },
    )
  })
}

/**
 * The CEF component the native layer loads when the app bundle carries no CEF (patch 0015):
 * `<appData>/<identifier>/cef/<cefVersion>-<arch>`, where `identifier` is the one in the bundle's
 * `Resources/version.json`, which Electrobun's launcher hands the native layer too.
 */
export const electrobunBrowserEngine: BrowserEngineShape = createCefComponentEngine({
  platform: process.platform,
  arch: process.arch,
  manifest: () => decodeCefComponentManifest(manifest),
  // The bundle's `Contents/MacOS/bun` runs the main process; its frameworks sit beside it.
  bundledFramework: path.resolve(
    path.dirname(process.execPath),
    '..',
    'Frameworks',
    CEF_FRAMEWORK_BINARY,
  ),
  componentsDirectory: async () => {
    const { identifier } = await electrobun().Updater.getLocalInfo()
    return path.join(appPaths.appData(), identifier, COMPONENTS_DIRECTORY)
  },
  fetch: (url) => networkFetch.fetch(url),
  extract: extractTarXz,
})
