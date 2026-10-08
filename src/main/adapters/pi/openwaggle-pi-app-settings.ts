import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import {
  type OpenWagglePiAppSettings,
  piUserAppSettings,
} from './openwaggle-pi-settings-app-overlay'

let latest: Settings | undefined

/** The Host passes in the Settings it may act on, as they load and change. */
export function setOpenWagglePiAppSettingsSource(settings: Settings | undefined) {
  latest = settings
}

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

/** The user's own Pi values for OpenWaggle's settings, read from their global Pi settings file. */
export function readPiUserAppSettingsFile(): Partial<OpenWagglePiAppSettings> {
  try {
    return piUserAppSettings(readFileSync(path.join(getAgentDir(), 'settings.json'), 'utf8'))
  } catch {
    return {}
  }
}
