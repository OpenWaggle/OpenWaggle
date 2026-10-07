import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { onAuthoritativeSettingsChange } from '../../store/authoritative-settings'
import type { OpenWagglePiAppSettings } from './openwaggle-pi-settings-app-overlay'

let latest: Settings | undefined

onAuthoritativeSettingsChange((settings) => {
  latest = settings
})

export function openWagglePiAppSettingsFrom(settings: Settings): OpenWagglePiAppSettings {
  return {
    codemodeEnabled: settings.codemodeEnabled,
    cacheWarming: settings.cacheWarming,
  }
}

/**
 * The OpenWaggle settings with a Pi equivalent, read when a Pi runtime is built so each Run uses
 * the current choice. Before Settings load, OpenWaggle's defaults apply.
 */
export function currentOpenWagglePiAppSettings(): OpenWagglePiAppSettings {
  return openWagglePiAppSettingsFrom(latest ?? DEFAULT_SETTINGS)
}
