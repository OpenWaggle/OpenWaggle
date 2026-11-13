/**
 * Where scripts/check-native-platform-floor.ts finds the main executable and the packaged
 * application code of an Electron app, an Electrobun app (wrapper plus self-extracting payload),
 * and an Electrobun native-layer devkit.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { type AsarArchive, readAsarArchive } from './asar-archive'
import {
  electrobunLauncher,
  electrobunPayloads,
  extractElectrobunPayload,
} from './electrobun-payload'

export type FloorPlatform = 'darwin' | 'linux' | 'win32'
/** `electrobun-devkit` is a native-layer devkit rather than a packaged app. */
export type FloorShell = 'electron' | 'electrobun' | 'electrobun-devkit'

export interface FloorOptions {
  readonly devkit?: boolean
}

interface AppFindings {
  readonly checked: number
  readonly foreign: readonly string[]
  readonly violations: readonly string[]
}
type CheckApp = (appRoot: string) => Promise<AppFindings>

const MAIN_EXECUTABLE: Readonly<Record<FloorPlatform, string>> = {
  darwin: 'Contents/MacOS/OpenWaggle',
  linux: 'openwaggle',
  win32: 'OpenWaggle.exe',
}
const APP_ASAR: Readonly<Record<FloorPlatform, string>> = {
  darwin: 'Contents/Resources/app.asar',
  linux: 'resources/app.asar',
  win32: 'resources/app.asar',
}
/** Electrobun keeps the bundled app as a directory, or as an asar archive when configured to. */
const ELECTROBUN_APP: Readonly<Record<FloorPlatform, string>> = {
  darwin: 'Contents/Resources/app',
  linux: 'Resources/app',
  win32: 'Resources/app',
}
const DEVKIT_LAUNCHER: Readonly<Record<FloorPlatform, string>> = {
  darwin: 'launcher',
  linux: 'launcher',
  win32: 'launcher.exe',
}
const ASAR_SUFFIX = '.asar'

export async function listFiles(root: string) {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    )
    .sort((left, right) => left.localeCompare(right))
}

async function pathExists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

export async function detectShell(root: string, platform: FloorPlatform, options: FloorOptions) {
  if (options.devkit === true) {
    return { shell: 'electrobun-devkit', executable: DEVKIT_LAUNCHER[platform] } as const
  }
  if (await pathExists(path.join(root, MAIN_EXECUTABLE[platform]))) {
    return { shell: 'electron', executable: MAIN_EXECUTABLE[platform] } as const
  }
  const launcher = await electrobunLauncher(root, platform)
  if (launcher !== null) return { shell: 'electrobun', executable: launcher } as const
  throw new Error(
    `${root} has no main executable: neither ${MAIN_EXECUTABLE[platform]} (Electron) nor Electrobun's launcher.`,
  )
}

/** Presents an unpacked app directory with the same interface as an asar archive. */
async function directoryArchive(directory: string) {
  const files = new Map<string, { readonly size: number; readonly offset: number | null }>()
  for (const file of await listFiles(directory)) {
    const { size } = await fs.stat(path.join(directory, file))
    files.set(`/${file}`, { size, offset: null })
  }
  const archive: AsarArchive = {
    files,
    readFile: (archivePath) => fs.readFile(path.join(directory, archivePath)),
  }
  return archive
}

/** The packaged application code whose native dependencies must ship, or null when there is none. */
export async function applicationArchive(root: string, platform: FloorPlatform, shell: FloorShell) {
  if (shell === 'electron') return readAsarArchive(path.join(root, APP_ASAR[platform]))
  if (shell === 'electrobun-devkit') return null
  const app = path.join(root, ELECTROBUN_APP[platform])
  if (await pathExists(`${app}${ASAR_SUFFIX}`)) return readAsarArchive(`${app}${ASAR_SUFFIX}`)
  if (await pathExists(app)) return directoryArchive(app)
  return null
}

/** Unpacks an Electrobun payload and checks each app inside it as an app of its own. */
async function checkPayload(payload: string, check: CheckApp) {
  const { directory, roots } = await extractElectrobunPayload(payload)
  const label = path.basename(payload)
  try {
    if (roots.length === 0) {
      return { checked: 0, foreign: [], violations: [`${label} contains no app`] }
    }
    let checked = 0
    const foreign: string[] = []
    const violations: string[] = []
    for (const appRoot of roots) {
      const prefix = `${label}:${path.basename(appRoot)}/`
      const report = await check(appRoot)
      checked += report.checked
      foreign.push(...report.foreign.map((entry) => `${prefix}${entry}`))
      violations.push(...report.violations.map((violation) => `${prefix}${violation}`))
    }
    return { checked, foreign, violations }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}

/** Checks every app inside each payload of an Electrobun wrapper, prefixing findings with it. */
export async function payloadReports(root: string, platform: FloorPlatform, check: CheckApp) {
  let checked = 0
  const foreign: string[] = []
  const violations: string[] = []
  for (const payload of await electrobunPayloads(root, platform)) {
    const inner = await checkPayload(payload, check)
    checked += inner.checked
    foreign.push(...inner.foreign)
    violations.push(...inner.violations)
  }
  return { checked, foreign, violations }
}
