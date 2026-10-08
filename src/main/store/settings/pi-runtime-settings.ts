/**
 * OpenWaggle Settings with a Pi equivalent: codemode (on by default, ADR 0048) and Pi's prompt
 * cache warming. They are stored here and handed to Pi in memory by the Pi adapter
 * (adapters/pi/openwaggle-pi-settings-app-overlay.ts), so Pi's own files never record them.
 *
 * OpenWaggle first, then Pi: a value the user chose in OpenWaggle wins; until they choose, the
 * user's own Pi value applies, and OpenWaggle's default only when Pi has none.
 */
import { DEFAULT_SETTINGS, PI_CACHE_WARMING_MODES, type Settings } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import { SETTINGS_KEY_CACHE_WARMING, SETTINGS_KEY_CODEMODE_ENABLED } from './keys'
import { appendChangedSetting, type SettingsPatchWrite } from './settings-patch-writes'

/** The user's own Pi values for these settings, from their global Pi settings. */
export interface PiUserRuntimeSettings {
  readonly codemodeEnabled?: boolean
  readonly cacheWarming?: Settings['cacheWarming']
}

type PiUserRuntimeSettingsReader = () => PiUserRuntimeSettings

const readNoPiUserSettings: PiUserRuntimeSettingsReader = () => ({})
let readPiUserRuntimeSettings = readNoPiUserSettings

/** Installed by the Host, which can read Pi's settings. Returns the function that removes it. */
export function configurePiUserRuntimeSettingsReader(reader: PiUserRuntimeSettingsReader) {
  readPiUserRuntimeSettings = reader
  return () => {
    if (readPiUserRuntimeSettings === reader) readPiUserRuntimeSettings = readNoPiUserSettings
  }
}

function piUserRuntimeSettings(): PiUserRuntimeSettings {
  try {
    return readPiUserRuntimeSettings()
  } catch {
    return {}
  }
}

function resolveCodemodeEnabled(raw: unknown, fallback: () => boolean | undefined) {
  return typeof raw === 'boolean' ? raw : (fallback() ?? DEFAULT_SETTINGS.codemodeEnabled)
}

function resolveCacheWarming(
  raw: unknown,
  fallback: () => Settings['cacheWarming'] | undefined,
): Settings['cacheWarming'] {
  return typeof raw === 'string' && includes(PI_CACHE_WARMING_MODES, raw)
    ? raw
    : (fallback() ?? DEFAULT_SETTINGS.cacheWarming)
}

function storedValue(storedSettings: Readonly<Record<string, unknown>>, key: string) {
  return Object.hasOwn(storedSettings, key) ? storedSettings[key] : undefined
}

export function resolveStoredPiRuntimeSettings(storedSettings: Readonly<Record<string, unknown>>) {
  let piUser: PiUserRuntimeSettings | undefined
  const fromPi = () => {
    piUser ??= piUserRuntimeSettings()
    return piUser
  }
  const storedCodemode = storedValue(storedSettings, SETTINGS_KEY_CODEMODE_ENABLED)
  const storedCacheWarming = storedValue(storedSettings, SETTINGS_KEY_CACHE_WARMING)
  return {
    codemodeEnabled: resolveCodemodeEnabled(storedCodemode, () => fromPi().codemodeEnabled),
    cacheWarming: resolveCacheWarming(storedCacheWarming, () => fromPi().cacheWarming),
    piRuntimeSettingsChosen: {
      codemodeEnabled: typeof storedCodemode === 'boolean',
      cacheWarming:
        typeof storedCacheWarming === 'string' &&
        includes(PI_CACHE_WARMING_MODES, storedCacheWarming),
    },
  }
}

export function resolveNextPiRuntimeSettings(current: Settings, partial: Partial<Settings>) {
  return {
    codemodeEnabled:
      partial.codemodeEnabled === undefined
        ? current.codemodeEnabled
        : resolveCodemodeEnabled(partial.codemodeEnabled, () => current.codemodeEnabled),
    cacheWarming:
      partial.cacheWarming === undefined
        ? current.cacheWarming
        : resolveCacheWarming(partial.cacheWarming, () => current.cacheWarming),
    piRuntimeSettingsChosen: {
      codemodeEnabled:
        current.piRuntimeSettingsChosen.codemodeEnabled || partial.codemodeEnabled !== undefined,
      cacheWarming:
        current.piRuntimeSettingsChosen.cacheWarming || partial.cacheWarming !== undefined,
    },
  }
}

export function appendPiRuntimeSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  appendChangedSetting(
    writes,
    partial.codemodeEnabled !== undefined,
    SETTINGS_KEY_CODEMODE_ENABLED,
    next.codemodeEnabled,
  )
  appendChangedSetting(
    writes,
    partial.cacheWarming !== undefined,
    SETTINGS_KEY_CACHE_WARMING,
    next.cacheWarming,
  )
}
