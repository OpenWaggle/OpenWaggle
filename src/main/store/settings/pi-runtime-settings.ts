/**
 * OpenWaggle Settings with a Pi equivalent: codemode (on by default, ADR 0048) and Pi's prompt
 * cache warming. They are stored here and handed to Pi in memory by the Pi adapter
 * (adapters/pi/openwaggle-pi-settings-app-overlay.ts), so Pi's own files never record them.
 */
import { DEFAULT_SETTINGS, PI_CACHE_WARMING_MODES, type Settings } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import { SETTINGS_KEY_CACHE_WARMING, SETTINGS_KEY_CODEMODE_ENABLED } from './keys'
import { appendChangedSetting, type SettingsPatchWrite } from './settings-patch-writes'

function resolveCodemodeEnabled(raw: unknown) {
  return typeof raw === 'boolean' ? raw : DEFAULT_SETTINGS.codemodeEnabled
}

function resolveCacheWarming(raw: unknown) {
  return typeof raw === 'string' && includes(PI_CACHE_WARMING_MODES, raw)
    ? raw
    : DEFAULT_SETTINGS.cacheWarming
}

function storedValue(storedSettings: Readonly<Record<string, unknown>>, key: string) {
  return Object.hasOwn(storedSettings, key) ? storedSettings[key] : undefined
}

export function resolveStoredPiRuntimeSettings(storedSettings: Readonly<Record<string, unknown>>) {
  return {
    codemodeEnabled: resolveCodemodeEnabled(
      storedValue(storedSettings, SETTINGS_KEY_CODEMODE_ENABLED),
    ),
    cacheWarming: resolveCacheWarming(storedValue(storedSettings, SETTINGS_KEY_CACHE_WARMING)),
  }
}

export function resolveNextPiRuntimeSettings(current: Settings, partial: Partial<Settings>) {
  return {
    codemodeEnabled:
      partial.codemodeEnabled === undefined
        ? current.codemodeEnabled
        : resolveCodemodeEnabled(partial.codemodeEnabled),
    cacheWarming:
      partial.cacheWarming === undefined
        ? current.cacheWarming
        : resolveCacheWarming(partial.cacheWarming),
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
