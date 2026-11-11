/**
 * Where scripts/check-native-platform-floor.ts finds the main executable and the packaged
 * application code of an Electrobun app (wrapper plus self-extracting payload, or the unwrapped
 * app) and of an Electrobun native-layer devkit.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  ELECTROBUN_LAUNCHER,
  electrobunLauncher,
  electrobunPayloads,
  extractElectrobunPayload,
} from './electrobun-payload'
import type { PackagedAppFiles } from './packaged-native-dependencies'

export type FloorPlatform = 'darwin' | 'linux' | 'win32'
/** `electrobun-devkit` is a native-layer devkit rather than a packaged app. */
export type FloorShell = 'electrobun' | 'electrobun-devkit'

export interface FloorOptions {
  readonly devkit?: boolean
}

interface AppFindings {
  readonly checked: number
  readonly foreign: readonly string[]
  readonly violations: readonly string[]
}
type CheckApp = (appRoot: string) => Promise<AppFindings>

/** Where Electrobun keeps the bundled app directory (scripts/electrobun/app-config.ts `copy`). */
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
  const launcher = await electrobunLauncher(root, platform)
  if (launcher !== null) return { shell: 'electrobun', executable: launcher } as const
  throw new Error(
    `${root} has no main executable: no Electrobun launcher at ${ELECTROBUN_LAUNCHER[platform].join(' or ')}.`,
  )
}

/** The files of an unpacked app directory, by `/`-rooted path. */
async function directoryFiles(directory: string) {
  const files = new Set<string>()
  for (const file of await listFiles(directory)) files.add(`/${file}`)
  const appFiles: PackagedAppFiles = {
    files,
    readFile: (archivePath) => fs.readFile(path.join(directory, archivePath)),
  }
  return appFiles
}

/**
 * The packaged application code whose native dependencies must ship, or null when there is none:
 * a devkit, or a wrapper whose app is in its payload.
 */
export async function applicationFiles(root: string, platform: FloorPlatform, shell: FloorShell) {
  if (shell === 'electrobun-devkit') return null
  const app = path.join(root, ELECTROBUN_APP[platform])
  return (await pathExists(app)) ? directoryFiles(app) : null
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
