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
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { createLogger } from '../logger'
import {
  legacySessionDatabasePath,
  sessionHostDatabasePath,
} from '../session-host/local-session-host-layout'
import { onAuthoritativeSettingsChange } from '../store/authoritative-settings'
import { USAGE_STATISTICS_DIRECTORY_NAME } from './usage-statistics-directory'
import {
  readUsageStatisticsJsonFile,
  removeStaleUsageStatisticsTemporaryFiles,
  writeUsageStatisticsJsonFileSync,
} from './usage-statistics-json-file'

export const LAST_KNOWN_SETTING_FILE_NAME = 'last-known-setting.json'

const RETRY_BASE_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 60_000
const RETRY_BACKOFF_FACTOR = 2

const logger = createLogger('usage-statistics')

const lastKnownSettingSchema = Schema.Struct({ usageStatisticsEnabled: Schema.Boolean })

function decodeLastKnownSetting(value: unknown): boolean | null {
  return decodeUnknownOrThrow(lastKnownSettingSchema, value).usageStatisticsEnabled
}

export function lastKnownSettingPath(userDataDirectory: string) {
  return path.join(userDataDirectory, USAGE_STATISTICS_DIRECTORY_NAME, LAST_KNOWN_SETTING_FILE_NAME)
}

/** The saved Setting; `null` when the file is missing, unreadable or corrupt. */
function readSaved(filePath: string): boolean | null {
  return readUsageStatisticsJsonFile({
    filePath,
    label: LAST_KNOWN_SETTING_FILE_NAME,
    decode: decodeLastKnownSetting,
    fallback: null,
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function removeStaleOn(filePath: string) {
  try {
    rmSync(filePath, { force: true })
  } catch (error) {
    logger.warn('A stale Usage statistics Setting could not be removed', {
      file: LAST_KNOWN_SETTING_FILE_NAME,
      error: errorMessage(error),
    })
  }
}

/**
 * Session Host only: saves the Setting each time the Host's authoritative Settings load or change,
 * before the change returns. Every write is synchronous, so no earlier write can land after a
 * later one. When a value cannot be saved, for example while antivirus holds the file, an "off"
 * still removes an earlier "on" (no file on an install with a store is unknown, which is off),
 * and the write is retried with backoff and once more when the process exits. Returns the
 * function that stops it.
 */
export function recordLastKnownUsageStatisticsSetting(userDataDirectory: string): () => void {
  const filePath = lastKnownSettingPath(userDataDirectory)
  removeStaleUsageStatisticsTemporaryFiles(filePath, LAST_KNOWN_SETTING_FILE_NAME)
  let saved = readSaved(filePath)
  let wanted: boolean | undefined
  let failures = 0
  let retry: ReturnType<typeof setTimeout> | undefined

  const persist = () => {
    if (retry) clearTimeout(retry)
    retry = undefined
    if (wanted === undefined || saved === wanted) return
    try {
      writeUsageStatisticsJsonFileSync(filePath, { usageStatisticsEnabled: wanted })
    } catch (error) {
      logger.warn('The Usage statistics Setting could not be saved; retrying', {
        file: LAST_KNOWN_SETTING_FILE_NAME,
        error: errorMessage(error),
      })
    }
    saved = readSaved(filePath)
    if (saved === wanted) {
      failures = 0
      return
    }
    if (!wanted && saved === true) {
      removeStaleOn(filePath)
      saved = readSaved(filePath)
    }
    failures += 1
    const delay = RETRY_BASE_DELAY_MS * RETRY_BACKOFF_FACTOR ** failures
    retry = setTimeout(persist, Math.min(delay, MAX_RETRY_DELAY_MS))
    retry.unref?.()
  }

  process.once('exit', persist)
  const unsubscribe = onAuthoritativeSettingsChange((settings) => {
    if (!settings) return
    wanted = settings.usageStatisticsEnabled
    persist()
  })
  return () => {
    unsubscribe()
    if (retry) clearTimeout(retry)
    process.off('exit', persist)
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
