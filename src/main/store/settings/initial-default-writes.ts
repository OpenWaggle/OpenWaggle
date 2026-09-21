import type { Settings } from '@shared/types/settings'
import { SETTINGS_KEY_DEFAULT_MODEL, SETTINGS_KEY_UPDATE_CHANNEL } from './keys'
import type { SettingsPatchWrite } from './persistence-plan'

/** Values resolved from runtime context that must become durable after the first successful read. */
export function collectInitialDefaultWrites(
  storedSettings: Readonly<Record<string, unknown>>,
  settings: Settings,
): SettingsPatchWrite[] {
  const writes: SettingsPatchWrite[] = []
  if (settings.selectedModel !== storedSettings[SETTINGS_KEY_DEFAULT_MODEL]) {
    writes.push({ key: SETTINGS_KEY_DEFAULT_MODEL, value: settings.selectedModel })
  }
  if (storedSettings[SETTINGS_KEY_UPDATE_CHANNEL] === undefined) {
    writes.push({ key: SETTINGS_KEY_UPDATE_CHANNEL, value: settings.updateChannel })
  }
  return writes
}
