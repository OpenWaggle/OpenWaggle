import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SESSION_DATA_DIRECTORY_NAME = 'session-data'
const CHROMIUM_DIPS_BASENAME = 'DIPS'
const CHROMIUM_DIPS_SIDE_SUFFIXES = ['', '-wal', '-shm'] as const
const CHROMIUM_DIPS_REPAIR_MARKER_FILENAME = '.openwaggle-dips-repair-v1'

export interface AppPathManager {
  getPath(name: 'userData'): string
  setPath(name: 'userData' | 'sessionData', value: string): void
}

function getChromiumDipsPaths(sessionDataPath: string): readonly string[] {
  return CHROMIUM_DIPS_SIDE_SUFFIXES.map((suffix) =>
    join(sessionDataPath, `${CHROMIUM_DIPS_BASENAME}${suffix}`),
  )
}

function repairChromiumDipsDatabaseOnce(sessionDataPath: string): void {
  const repairMarkerPath = join(sessionDataPath, CHROMIUM_DIPS_REPAIR_MARKER_FILENAME)
  if (existsSync(repairMarkerPath)) {
    return
  }

  const chromiumDipsPaths = getChromiumDipsPaths(sessionDataPath)
  const hasExistingChromiumDipsState = chromiumDipsPaths.some((chromiumDipsPath) =>
    existsSync(chromiumDipsPath),
  )

  if (hasExistingChromiumDipsState) {
    for (const chromiumDipsPath of chromiumDipsPaths) {
      rmSync(chromiumDipsPath, { force: true })
    }
  }

  // Versioned marker: this is a one-time profile repair, not a per-launch reset.
  writeFileSync(repairMarkerPath, `${CHROMIUM_DIPS_REPAIR_MARKER_FILENAME}\n`)
}

export function configureAppStoragePaths(
  appPaths: AppPathManager,
  overrideUserDataPath?: string,
): void {
  const userDataPath = overrideUserDataPath ?? appPaths.getPath('userData')
  appPaths.setPath('userData', userDataPath)
  mkdirSync(userDataPath, { recursive: true })

  const sessionDataPath = join(userDataPath, SESSION_DATA_DIRECTORY_NAME)
  mkdirSync(sessionDataPath, { recursive: true })
  repairChromiumDipsDatabaseOnce(sessionDataPath)
  appPaths.setPath('sessionData', sessionDataPath)
}
