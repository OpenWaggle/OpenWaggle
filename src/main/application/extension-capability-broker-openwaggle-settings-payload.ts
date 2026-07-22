import { isAbsolute } from 'node:path'
import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import type { ExtensionSettingsUpdatePayload } from '@shared/types/extension-broker'
import { unsupportedPayloadIssues } from './extension-capability-broker-payload'

const SETTINGS_GET_PAYLOAD_KEYS = new Set(['key', 'projectPath'])
const SETTINGS_GET_MODEL_PREFERENCES_PAYLOAD_KEYS = new Set(['key'])
const SETTINGS_GET_PROJECT_DISPLAY_NAME_PAYLOAD_KEYS = new Set(['key', 'projectPath'])
const SETTINGS_UPDATE_KEYS = new Set([
  'selectedModel',
  'favoriteModels',
  'enabledModels',
  'thinkingLevel',
  'projectDisplayNames',
])
const SETTINGS_UPDATE_SETTING_PAYLOAD_KEYS = new Set(['key', 'projectPath', 'value'])
const SETTINGS_UPDATE_MODEL_PREFERENCES_PAYLOAD_KEYS = new Set(['key', 'value'])
const SETTINGS_UPDATE_PROJECT_DISPLAY_NAME_PAYLOAD_KEYS = new Set(['key', 'projectPath', 'value'])

const settingPayloadKeySchema = Schema.Struct({
  key: Schema.String,
})

type SettingsUpdateValidationResult =
  | { readonly _tag: 'valid'; readonly payload: ExtensionSettingsUpdatePayload }
  | { readonly _tag: 'invalid'; readonly message: string }

type ProjectDisplayNamePathValidationResult =
  | { readonly _tag: 'valid'; readonly projectPath: string }
  | { readonly _tag: 'invalid'; readonly message: string }

function settingPayloadKey(payload: unknown) {
  const decoded = safeDecodeUnknown(settingPayloadKeySchema, payload)
  return decoded.success ? decoded.data.key : null
}

function settingsGetPayloadKeys(payload: unknown) {
  const key = settingPayloadKey(payload)
  if (key === OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES) {
    return SETTINGS_GET_MODEL_PREFERENCES_PAYLOAD_KEYS
  }
  if (key === OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME) {
    return SETTINGS_GET_PROJECT_DISPLAY_NAME_PAYLOAD_KEYS
  }
  return SETTINGS_GET_PAYLOAD_KEYS
}

function settingsUpdateSettingPayloadKeys(payload: unknown) {
  const key = settingPayloadKey(payload)
  if (key === OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES) {
    return SETTINGS_UPDATE_MODEL_PREFERENCES_PAYLOAD_KEYS
  }
  if (key === OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME) {
    return SETTINGS_UPDATE_PROJECT_DISPLAY_NAME_PAYLOAD_KEYS
  }
  return SETTINGS_UPDATE_SETTING_PAYLOAD_KEYS
}

function validateProjectDisplayNamePath(
  projectPath: string,
): ProjectDisplayNamePathValidationResult {
  const normalized = projectPath.trim()
  if (normalized.length === 0) {
    return { _tag: 'invalid', message: 'Project path is required.' }
  }
  if (!isAbsolute(normalized)) {
    return { _tag: 'invalid', message: 'Project path must be absolute.' }
  }
  return { _tag: 'valid', projectPath: normalized }
}

export function settingsGetPayloadIssues(payload: unknown) {
  return unsupportedPayloadIssues(payload, settingsGetPayloadKeys(payload))
}

export function settingsUpdatePayloadIssues(payload: unknown) {
  return unsupportedPayloadIssues(payload, SETTINGS_UPDATE_KEYS)
}

export function settingsUpdateSettingPayloadIssues(payload: unknown) {
  return unsupportedPayloadIssues(payload, settingsUpdateSettingPayloadKeys(payload))
}

export function validateSettingsUpdateProjectDisplayNames(
  payload: ExtensionSettingsUpdatePayload,
): SettingsUpdateValidationResult {
  if (payload.projectDisplayNames === undefined) {
    return { _tag: 'valid', payload }
  }

  const projectDisplayNames: Record<string, string> = {}
  for (const [projectPath, displayName] of Object.entries(payload.projectDisplayNames)) {
    const validation = validateProjectDisplayNamePath(projectPath)
    if (validation._tag === 'invalid') {
      return {
        _tag: 'invalid',
        message: validation.message,
      }
    }
    projectDisplayNames[validation.projectPath] = displayName
  }

  return {
    _tag: 'valid',
    payload: { ...payload, projectDisplayNames },
  }
}
