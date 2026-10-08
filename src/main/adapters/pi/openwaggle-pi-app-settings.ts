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

/**
 * OpenWaggle first, then Pi: a setting the user chose in OpenWaggle wins. Any other follows the
 * user's own Pi settings as they are now, read again each time, so a change to them while the app
 * runs applies to the next Run; OpenWaggle's default applies when Pi has no value.
 */
export function openWagglePiAppSettingsFrom(
  settings: Settings,
  readPiUser: () => Partial<OpenWagglePiAppSettings> = readPiUserAppSettingsFile,
): OpenWagglePiAppSettings {
  const chosen = settings.piRuntimeSettingsChosen
  let piUser: Partial<OpenWagglePiAppSettings> | undefined
  const fromPi = () => {
    piUser ??= chosen.codemodeEnabled && chosen.cacheWarming ? {} : readPiUser()
    return piUser
  }
  return {
    codemodeEnabled: chosen.codemodeEnabled
      ? settings.codemodeEnabled
      : (fromPi().codemodeEnabled ?? DEFAULT_SETTINGS.codemodeEnabled),
    cacheWarming: chosen.cacheWarming
      ? settings.cacheWarming
      : (fromPi().cacheWarming ?? DEFAULT_SETTINGS.cacheWarming),
  }
}

/**
 * The OpenWaggle settings with a Pi equivalent, read when a Pi runtime is built so each Run uses
 * the current choice. Before Settings load, the user's Pi values or OpenWaggle's defaults apply.
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
