/**
 * The `usageStatisticsEnabled` Setting as the Session Host last loaded it, kept in a small file so
 * a process that cannot load Settings can still honour the person's choice (issue #446).
 *
 * Error reports wait for Settings, because an unknown Setting counts as off. Settings come from the
 * Session Host, so a Host that does not start would otherwise also drop the report saying why. The
 * Host, the only process that owns Settings and the only writer, saves the Setting here each time
 * it loads or changes; a GUI or Host that fails before Settings load reads it. An install whose
 * Session Host never kept a store has never stored the Setting either, so its default applies.
 * A file that is missing, unreadable or corrupt on an install that does have a store is unknown,
 * and unknown stays off.
 */
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { createLogger } from '../logger'
import {
  legacySessionDatabasePath,
  sessionHostDatabasePath,
} from '../session-host/local-session-host-layout'
import { onAuthoritativeSettingsChange } from '../store/authoritative-settings'
import { USAGE_STATISTICS_DIRECTORY_NAME } from './usage-statistics-directory'
import {
  openUsageStatisticsJsonFile,
  readUsageStatisticsJsonFile,
} from './usage-statistics-json-file'

export const LAST_KNOWN_SETTING_FILE_NAME = 'last-known-setting.json'

const logger = createLogger('usage-statistics')

interface LastKnownSetting {
  readonly usageStatisticsEnabled: boolean | null
}

const UNKNOWN: LastKnownSetting = { usageStatisticsEnabled: null }

function decodeLastKnownSetting(value: unknown): LastKnownSetting {
  if (typeof value !== 'object' || value === null) throw new Error('Not an object.')
  const enabled: unknown = Reflect.get(value, 'usageStatisticsEnabled')
  if (typeof enabled !== 'boolean') throw new Error('No usageStatisticsEnabled value.')
  return { usageStatisticsEnabled: enabled }
}

export function lastKnownSettingPath(userDataDirectory: string) {
  return path.join(userDataDirectory, USAGE_STATISTICS_DIRECTORY_NAME, LAST_KNOWN_SETTING_FILE_NAME)
}

/**
 * Session Host only: saves the Setting each time the Host's authoritative Settings load or change.
 * Returns the unsubscribe function.
 */
function readSaved(filePath: string) {
  return readUsageStatisticsJsonFile({
    filePath,
    label: LAST_KNOWN_SETTING_FILE_NAME,
    decode: decodeLastKnownSetting,
    fallback: UNKNOWN,
  }).usageStatisticsEnabled
}

export function recordLastKnownUsageStatisticsSetting(userDataDirectory: string): () => void {
  const filePath = lastKnownSettingPath(userDataDirectory)
  const file = openUsageStatisticsJsonFile({
    filePath,
    label: LAST_KNOWN_SETTING_FILE_NAME,
    decode: decodeLastKnownSetting,
    initial: UNKNOWN,
  })
  return onAuthoritativeSettingsChange((settings) => {
    if (!settings) return
    const enabled = settings.usageStatisticsEnabled
    if (file.read().usageStatisticsEnabled === enabled) return
    file.update(() => ({ usageStatisticsEnabled: enabled }))
    // Written now, not after the write delay: a Host that fails next must not lose it.
    file.flushSync()
    if (readSaved(filePath) === enabled) return
    // Not saved, for example while antivirus holds the file. A stale "on" must never outlive
    // the person turning statistics off, so remove it: no file on an install with a store is
    // unknown, which is off. The write is retried in the background either way.
    if (!enabled) removeStaleOn(filePath)
    file.flush().catch(() => undefined)
  })
}

function removeStaleOn(filePath: string) {
  try {
    rmSync(filePath, { force: true })
  } catch (error) {
    logger.warn('A stale Usage statistics Setting could not be removed', {
      file: LAST_KNOWN_SETTING_FILE_NAME,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * The Setting to act on in a process that could not load Settings: the value the Session Host last
 * saved, the default on an install that never kept a Session Host store, or `undefined` (off).
 */
export function usageStatisticsSettingWithoutSettings(
  userDataDirectory: string,
  pathExists: (target: string) => boolean = existsSync,
): boolean | undefined {
  const saved = readSaved(lastKnownSettingPath(userDataDirectory))
  if (saved !== null) return saved
  const neverKeptAStore =
    !pathExists(sessionHostDatabasePath(userDataDirectory)) &&
    !pathExists(legacySessionDatabasePath(userDataDirectory))
  return neverKeptAStore ? DEFAULT_SETTINGS.usageStatisticsEnabled : undefined
}
