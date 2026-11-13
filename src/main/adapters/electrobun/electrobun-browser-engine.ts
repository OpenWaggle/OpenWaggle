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
const SYSTEM_XATTR = '/usr/bin/xattr'
const QUARANTINE = 'com.apple.quarantine'
const NO_SUCH_XATTR = 'No such xattr'
const COMPONENTS_DIRECTORY = 'cef'
const TOOL_OUTPUT_BYTES = 1_048_576

/** Runs a system tool; `tolerated` names a stderr text that still counts as success. */
function run(command: string, args: readonly string[], tolerated?: string) {
  return new Promise<void>((resolve, reject) => {
    execFile(
      command,
      [...args],
      { env: getSafeChildEnv(), maxBuffer: TOOL_OUTPUT_BYTES },
      (error, _stdout, stderr) => {
        if (error === null || (tolerated !== undefined && stderr.includes(tolerated))) resolve()
        else reject(new Error(stderr.trim() || error.message, { cause: error }))
      },
    )
  })
}

/**
 * Extracts the archive with its code signatures. bsdtar copies the archive's quarantine onto
 * every extracted file, and quarantined helper apps would meet Gatekeeper, so the quarantine is
 * removed from both: the pinned sha256 already vouched for the bytes.
 */
async function extractTarXz(archive: string, destination: string) {
  await run(SYSTEM_XATTR, ['-d', QUARANTINE, archive], NO_SUCH_XATTR)
  await run(SYSTEM_TAR, ['-xJf', archive, '-C', destination])
  await run(SYSTEM_XATTR, ['-dr', QUARANTINE, destination], NO_SUCH_XATTR)
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
  fetch: (url, init) => networkFetch.fetch(url, init),
  extract: extractTarXz,
})
