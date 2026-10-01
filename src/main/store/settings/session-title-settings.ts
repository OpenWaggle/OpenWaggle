import { parseSessionTitleModelSetting } from '@shared/session-title-model'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { SETTINGS_KEY_SESSION_TITLE_MODEL } from './keys'
import type { SettingsPatchWrite } from './persistence-plan'

export function resolveSessionTitleModel(raw: unknown) {
  return parseSessionTitleModelSetting(raw) ?? DEFAULT_SETTINGS.sessionTitleModel
}

export function resolveStoredSessionTitleSettings(
  storedSettings: Readonly<Record<string, unknown>>,
) {
  return {
    sessionTitleModel: resolveSessionTitleModel(
      Object.hasOwn(storedSettings, SETTINGS_KEY_SESSION_TITLE_MODEL)
        ? storedSettings[SETTINGS_KEY_SESSION_TITLE_MODEL]
        : undefined,
    ),
  }
}

export function resolveNextSessionTitleSettings(current: Settings, partial: Partial<Settings>) {
  return {
    sessionTitleModel:
      partial.sessionTitleModel === undefined
        ? current.sessionTitleModel
        : resolveSessionTitleModel(partial.sessionTitleModel),
  }
}

export function appendSessionTitleSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  if (partial.sessionTitleModel === undefined) return
  writes.push({ key: SETTINGS_KEY_SESSION_TITLE_MODEL, value: next.sessionTitleModel })
}
