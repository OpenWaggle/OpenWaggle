import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CommandLine } from 'electron'
import { limitChromiumHttpDiskCache } from './electron-chromium-cache-limit'
import { addChromiumFeature } from './chromium-feature-switch'

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

const AUDIO_SERVICE_OUT_OF_PROCESS = 'AudioServiceOutOfProcess'

/**
 * Run Chromium's audio service in the app process. Out of process it is a helper that starts with
 * the first Notification sound or voice input and never exits, 45 MB resident on macOS and about
 * 80 MB on Windows, for a few short tones. Keeps any features a `--disable-features` given on the
 * command line already turns off.
 */
export function runChromiumAudioServiceInProcess(
  commandLine: Pick<CommandLine, 'appendSwitch' | 'getSwitchValue'>,
) {
  addChromiumFeature(commandLine, 'disable-features', AUDIO_SERVICE_OUT_OF_PROCESS)
}

/**
 * Chromium's own profile (`sessionData`) under OpenWaggle's: repair its DIPS database once,
 * bound its HTTP disk cache and keep its audio service in process, all before the app is ready.
 */
export function prepareChromiumProfile(
  sessionDataPath: string,
  setSessionDataPath: (directory: string) => void,
  commandLine: Pick<CommandLine, 'appendSwitch' | 'hasSwitch' | 'getSwitchValue'>,
) {
  repairChromiumDipsDatabaseOnce(sessionDataPath)
  setSessionDataPath(sessionDataPath)
  limitChromiumHttpDiskCache(commandLine)
  runChromiumAudioServiceInProcess(commandLine)
}
