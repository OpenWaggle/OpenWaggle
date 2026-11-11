import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { BUILD_CHANNEL, PRODUCT_NAME } from '@shared/build-identity-runtime'
import type { BootShellShape } from '../../ports/desktop-shell/boot-shell'
import type { ShellCommandLineShape } from '../../ports/desktop-shell/app-lifecycle'
import { loadedElectrobun } from './electrobun-sdk'

/**
 * Electrobun's boot view of the shell (ADR 0064); `electrobunAppPaths`, `electrobunAppLifecycle`
 * and `electrobunSystemIntegration` reuse these members. It never loads the Electrobun SDK: the
 * boot shim, the Session Host and the CLI run it in plain `bun` processes. It reads
 * `process.env` directly for the same reason the boot shim does (`env.ts` brings Effect Schema).
 *
 * The directories are the ones Electron resolved, so an existing install keeps its data: a
 * release build's `userData` is the canonical `openwaggle` directory; a Dev build uses its own
 * product name so it never touches the installed release's data (ADR 0032).
 */

/** The package name that names a release build's `userData` (Electron's `app.getName()`). */
const RELEASE_USER_DATA_NAME = 'openwaggle'
const APP_PACKAGE_JSON = 'package.json'
/** Files Electrobun writes beside the packaged app directory (`Contents/Resources` on macOS). */
const ELECTROBUN_BUNDLE_MARKERS = ['version.json', 'build.json'] as const

const relocated: { userData: string | null } = { userData: null }

/** The per-user application-data root Electron used: it holds `userData`. */
export function applicationDataRoot(platform = process.platform, home = homedir()) {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support')
  if (platform === 'win32') {
    const roaming = process.env.APPDATA?.trim()
    return roaming ? roaming : path.join(home, 'AppData', 'Roaming')
  }
  const configHome = process.env.XDG_CONFIG_HOME?.trim()
  return configHome && path.isAbsolute(configHome) ? configHome : path.join(home, '.config')
}

/** The name of this build's `userData` directory. */
export function userDataName() {
  return BUILD_CHANNEL === 'dev' ? PRODUCT_NAME : RELEASE_USER_DATA_NAME
}

function readAppPackage(directory: string): unknown {
  const file = path.join(directory, APP_PACKAGE_JSON)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function isAppPackage(manifest: unknown) {
  return (
    typeof manifest === 'object' &&
    manifest !== null &&
    Reflect.get(manifest, 'name') === RELEASE_USER_DATA_NAME
  )
}

/**
 * The directory holding the app's `package.json`, found upward from this module: the source
 * checkout for `src/` and `out/main/`, `Resources/app` in a packaged app.
 */
function findAppRoot(start: string) {
  let directory = start
  while (true) {
    if (isAppPackage(readAppPackage(directory))) return directory
    const parent = path.dirname(directory)
    if (parent === directory) {
      throw new Error(`No OpenWaggle package.json above ${start}.`)
    }
    directory = parent
  }
}

let appRootCache: string | null = null
let versionCache: string | null = null

function appRoot() {
  appRootCache ??= findAppRoot(import.meta.dirname)
  return appRootCache
}

function version() {
  if (versionCache === null) {
    const manifest = readAppPackage(appRoot())
    const value: unknown =
      typeof manifest === 'object' && manifest ? Reflect.get(manifest, 'version') : null
    if (typeof value !== 'string') throw new Error('The app package.json names no version.')
    versionCache = value
  }
  return versionCache
}

/** An installed build: the app directory sits in a packaged Electrobun bundle. */
function isPackaged() {
  const resources = path.dirname(appRoot())
  return ELECTROBUN_BUNDLE_MARKERS.every((marker) => existsSync(path.join(resources, marker)))
}

const SWITCH_PREFIX = '--'

/** `--name`, `--name=value` and `--name value`, as Chromium reads its switches. */
function switchesFrom(argv: readonly string[]) {
  const switches = new Map<string, string>()
  for (const [index, argument] of argv.entries()) {
    if (!argument.startsWith(SWITCH_PREFIX) || argument === SWITCH_PREFIX) continue
    const body = argument.slice(SWITCH_PREFIX.length)
    const separator = body.indexOf('=')
    if (separator !== -1) {
      switches.set(body.slice(0, separator), body.slice(separator + 1))
      continue
    }
    const next = argv[index + 1]
    switches.set(body, next !== undefined && !next.startsWith('-') ? next : '')
  }
  return switches
}

let switchCache: Map<string, string> | null = null

function switches() {
  switchCache ??= switchesFrom(process.argv.slice(1))
  return switchCache
}

/**
 * The system webviews take no engine switches, so this only carries OpenWaggle's own
 * `--openwaggle-*` switches and whatever the process was started with. CEF's flags are set at
 * build time (`chromiumFlags` in electrobun.config.ts).
 */
export const electrobunCommandLine: ShellCommandLineShape = {
  hasSwitch: (name) => switches().has(name),
  getSwitchValue: (name) => switches().get(name) ?? '',
  appendSwitch: (name, value) => void switches().set(name, value ?? ''),
}

export const electrobunBootShell: BootShellShape = {
  // The name is chosen by `userDataName()` from the Build identity; nothing to rename.
  applyBuildIdentity: () => undefined,
  appRoot,
  userData: () => relocated.userData ?? path.join(applicationDataRoot(), userDataName()),
  version,
  isPackaged,
  exit: (code) => {
    const sdk = loadedElectrobun()
    if (sdk) sdk.Utils.quit(code ?? 0)
    else process.exit(code ?? 0)
  },
  commandLine: electrobunCommandLine,
  // Only the desktop app has a Dock icon; the Session Host and the CLI are plain processes.
  setActivationPolicy: (policy) =>
    loadedElectrobun()?.Utils.setDockIconVisible(policy === 'regular'),
}

/** Moves `userData` for this process (`OPENWAGGLE_USER_DATA_DIR`, test profiles). */
export function relocateUserData(directory: string) {
  relocated.userData = directory
}
