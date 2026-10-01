import { SupportedModelId } from './types/brand'
import { parseModelRef } from './types/llm'

/** Generate titles with the cheapest available model from the Session's own provider. */
export const SESSION_TITLE_MODEL_AUTOMATIC = 'automatic'
/** Never generate titles; Sessions keep their Provisional title until a person renames them. */
export const SESSION_TITLE_MODEL_OFF = 'off'

/**
 * The Title model setting: Automatic, Off, or one canonical `provider/modelId` reference the user
 * selected. A selected model from another provider receives each Session's first message.
 */
export type SessionTitleModelSetting =
  | typeof SESSION_TITLE_MODEL_AUTOMATIC
  | typeof SESSION_TITLE_MODEL_OFF
  | SupportedModelId

export const DEFAULT_SESSION_TITLE_MODEL: SessionTitleModelSetting = SESSION_TITLE_MODEL_AUTOMATIC

/** Accepts the two keywords or a well-formed model reference; anything else is not a setting. */
export function parseSessionTitleModelSetting(raw: unknown): SessionTitleModelSetting | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === SESSION_TITLE_MODEL_AUTOMATIC) return SESSION_TITLE_MODEL_AUTOMATIC
  if (trimmed === SESSION_TITLE_MODEL_OFF) return SESSION_TITLE_MODEL_OFF
  return parseModelRef(trimmed) ? SupportedModelId(trimmed) : null
}

export function isSessionTitleGenerationEnabled(setting: SessionTitleModelSetting) {
  return setting !== SESSION_TITLE_MODEL_OFF
}
