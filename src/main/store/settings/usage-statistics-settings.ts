/**
 * The global `usageStatisticsEnabled` Setting (ADR 0046): on by default, and only a saved
 * boolean turns it off. A present non-boolean value is rejected by persisted-settings
 * validation rather than read as on.
 */
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { SETTINGS_KEY_USAGE_STATISTICS_ENABLED } from './keys'
import { appendChangedSetting, type SettingsPatchWrite } from './settings-patch-writes'

export function resolveUsageStatisticsEnabled(raw: unknown) {
  return typeof raw === 'boolean' ? raw : DEFAULT_SETTINGS.usageStatisticsEnabled
}

export function resolveStoredUsageStatisticsSettings(
  storedSettings: Readonly<Record<string, unknown>>,
) {
  return {
    usageStatisticsEnabled: resolveUsageStatisticsEnabled(
      Object.hasOwn(storedSettings, SETTINGS_KEY_USAGE_STATISTICS_ENABLED)
        ? storedSettings[SETTINGS_KEY_USAGE_STATISTICS_ENABLED]
        : undefined,
    ),
  }
}

export function resolveNextUsageStatisticsSettings(current: Settings, partial: Partial<Settings>) {
  return {
    usageStatisticsEnabled:
      typeof partial.usageStatisticsEnabled === 'boolean'
        ? partial.usageStatisticsEnabled
        : current.usageStatisticsEnabled,
  }
}

export function appendUsageStatisticsSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  appendChangedSetting(
    writes,
    partial.usageStatisticsEnabled !== undefined,
    SETTINGS_KEY_USAGE_STATISTICS_ENABLED,
    next.usageStatisticsEnabled,
  )
}
