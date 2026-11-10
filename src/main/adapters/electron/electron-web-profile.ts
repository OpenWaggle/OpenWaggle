import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CommandLine } from 'electron'
import { limitChromiumHttpDiskCache } from './electron-chromium-cache-limit'

const CHROMIUM_DIPS_BASENAME = 'DIPS'
const CHROMIUM_DIPS_SIDE_SUFFIXES = ['', '-wal', '-shm'] as const
const CHROMIUM_DIPS_REPAIR_MARKER_FILENAME = '.openwaggle-dips-repair-v1'

function getChromiumDipsPaths(sessionDataPath: string) {
  return CHROMIUM_DIPS_SIDE_SUFFIXES.map((suffix) =>
    join(sessionDataPath, `${CHROMIUM_DIPS_BASENAME}${suffix}`),
  )
}

function repairChromiumDipsDatabaseOnce(sessionDataPath: string) {
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

/**
 * Chromium's own profile (`sessionData`) under OpenWaggle's: repair its DIPS database once and
 * bound its HTTP disk cache, both before the app is ready.
 */
export function prepareChromiumProfile(
  sessionDataPath: string,
  setSessionDataPath: (directory: string) => void,
  commandLine: Pick<CommandLine, 'appendSwitch' | 'hasSwitch'>,
) {
  repairChromiumDipsDatabaseOnce(sessionDataPath)
  setSessionDataPath(sessionDataPath)
  limitChromiumHttpDiskCache(commandLine)
}
