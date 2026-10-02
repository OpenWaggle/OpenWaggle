import { parseSessionTitleModelSetting, SESSION_TITLE_MODEL_OFF } from '@shared/session-title-model'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { createLogger } from '../../logger'
import { SETTINGS_KEY_SESSION_TITLE_MODEL } from './keys'
import type { SettingsPatchWrite } from './persistence-plan'

const SETTING_LOG_PREVIEW_LENGTH = 80

const logger = createLogger('session-title-settings')

/**
 * A missing value means the default, Automatic. A stored value that is not a Title model (a
 * hand-edited "none", say) fails closed to Off: whoever changed it meant something other than the
 * default, and guessing Automatic would send first messages to a provider they may have refused.
 */
export function resolveSessionTitleModel(raw: unknown) {
  if (raw === undefined || raw === null) return DEFAULT_SETTINGS.sessionTitleModel
  const parsed = parseSessionTitleModelSetting(raw)
  if (parsed !== null) return parsed
  logger.warn('Ignoring an invalid Title model setting; title generation is Off', {
    value: String(raw).slice(0, SETTING_LOG_PREVIEW_LENGTH),
  })
  return SESSION_TITLE_MODEL_OFF
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
