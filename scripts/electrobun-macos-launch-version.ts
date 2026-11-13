/**
 * Electrobun build hook (postBuild and postWrap) that keeps the macOS launch version in every
 * Info.plist the build writes. Hutch writes no `LSMinimumSystemVersion`, and the release guard
 * (scripts/check-native-platform-floor.ts) requires the launch version from
 * scripts/supported-platform-floor.ts, so macOS 12 through 13.3 still open the app and its
 * launcher can explain the 13.4 minimum instead of the bundle refusing to start.
 *
 * postBuild sees the unwrapped app in `ELECTROBUN_BUILD_DIR` before it is compressed into the
 * self-extracting payload; postWrap sees the wrapper in `ELECTROBUN_WRAPPER_BUNDLE_PATH`.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { SUPPORTED_PLATFORM_FLOOR } from './supported-platform-floor'

const MINIMUM_KEY = '<key>LSMinimumSystemVersion</key>'
const EXISTING_MINIMUM = /<key>LSMinimumSystemVersion<\/key>\s*<string>[^<]*<\/string>/u
const CLOSING_DICT = /\n?<\/dict>\s*<\/plist>\s*$/u
const APP_SUFFIX = '.app'
const INFO_PLIST = path.join('Contents', 'Info.plist')

/** Sets `LSMinimumSystemVersion` in an XML property list, replacing any existing value. */
export function withMinimumSystemVersion(plist: string, version: string) {
  const entry = `${MINIMUM_KEY}\n    <string>${version}</string>`
  if (EXISTING_MINIMUM.test(plist)) return plist.replace(EXISTING_MINIMUM, entry)
  if (!CLOSING_DICT.test(plist)) throw new Error('Info.plist has no closing </dict></plist>.')
  return plist.replace(CLOSING_DICT, `\n    ${entry}\n</dict>\n</plist>\n`)
}

async function appBundles(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(APP_SUFFIX))
    .map((entry) => path.join(directory, entry.name))
}

export async function applyLaunchVersion(
  environment: NodeJS.ProcessEnv,
  version: string = SUPPORTED_PLATFORM_FLOOR.macos.launchVersion,
) {
  if (environment.ELECTROBUN_OS !== 'macos') return []
  const wrapper = environment.ELECTROBUN_WRAPPER_BUNDLE_PATH
  const buildDirectory = environment.ELECTROBUN_BUILD_DIR
  const bundles =
    wrapper === undefined || wrapper === ''
      ? buildDirectory === undefined
        ? []
        : await appBundles(buildDirectory)
      : [wrapper]
  if (bundles.length === 0) throw new Error('No macOS app bundle found for the launch version.')
  for (const bundle of bundles) {
    const plistPath = path.join(bundle, INFO_PLIST)
    const plist = await fs.readFile(plistPath, 'utf8')
    await fs.writeFile(plistPath, withMinimumSystemVersion(plist, version))
  }
  return bundles
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyLaunchVersion(process.env).then(
    (bundles) => {
      for (const bundle of bundles) console.log(`LSMinimumSystemVersion set in ${bundle}`)
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    },
  )
}
