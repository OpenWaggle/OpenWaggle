import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { isNonEmptyString, isRecord, isStringArray } from './internal-validation.js'
import type {
  ExtensionActionSelectProjectResult,
  ExtensionModelPrefs,
  ExtensionSettingsGetResult,
  ExtensionSettingsGetSettingResult,
  ExtensionSettingsSelectedValue,
  ExtensionSettingsUpdateResult,
  ExtensionSettingsUpdateSettingResult,
  ExtensionStateCurrentBranchReadResult,
  ExtensionStateCurrentProjectReadResult,
  ExtensionStateCurrentSessionReadResult,
  ExtensionStateModelPreferencesReadResult,
  ExtensionStateReadResult,
  ExtensionStateRecentProjectsReadResult,
} from './types.js'

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isInvokeScope(value: unknown) {
  if (!isRecord(value)) {
    return false
  }

  if (value.kind === 'app') {
    return true
  }

  if (value.kind === 'project') {
    return isNonEmptyString(value.projectPath)
  }

  if (value.kind === 'session') {
    return isNonEmptyString(value.projectPath) && isNonEmptyString(value.sessionId)
  }

  return (
    value.kind === 'branch' &&
    isNonEmptyString(value.projectPath) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.branchId)
  )
}

function isStringRecord(value: unknown) {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function isModelPreferences(value: unknown): value is ExtensionModelPrefs {
  return (
    isRecord(value) &&
    typeof value.selectedModel === 'string' &&
    isStringArray(value.favoriteModels) &&
    isStringArray(value.enabledModels) &&
    typeof value.thinkingLevel === 'string'
  )
}

function isProjectView(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.projectPath) &&
    isStringOrNull(value.displayName) &&
    typeof value.active === 'boolean'
  )
}

function isSessionView(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.title) &&
    isStringOrNull(value.projectPath)
  )
}

function isBranchView(value: unknown) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.branchId) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.name) &&
    typeof value.main === 'boolean' &&
    typeof value.archived === 'boolean'
  )
}

function hasOpenWaggleResultBase(
  value: Readonly<Record<string, unknown>>,
  capability: string,
  method: string,
) {
  return (
    isNonEmptyString(value.extensionId) &&
    isNonEmptyString(value.contributionId) &&
    value.capability === capability &&
    value.method === method
  )
}

export function isStateReadResult(value: unknown): value is ExtensionStateReadResult {
  return (
    isRecord(value) &&
    hasOpenWaggleResultBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
    ) &&
    isInvokeScope(value.scope) &&
    isStringOrNull(value.activeProjectPath) &&
    (value.currentProject === null || isProjectView(value.currentProject)) &&
    (value.currentSession === null || isSessionView(value.currentSession)) &&
    (value.currentBranch === null || isBranchView(value.currentBranch)) &&
    isStringArray(value.recentProjects) &&
    isModelPreferences(value.modelPreferences)
  )
}

function isSelectedStateResult(
  value: unknown,
  selector: string,
  isSelectedValue: (selectedValue: unknown) => boolean,
) {
  return (
    isRecord(value) &&
    hasOpenWaggleResultBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
    ) &&
    isInvokeScope(value.scope) &&
    value.selector === selector &&
    isSelectedValue(value.value)
  )
}

export function isStateCurrentProjectReadResult(
  value: unknown,
): value is ExtensionStateCurrentProjectReadResult {
  return isSelectedStateResult(
    value,
    OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_PROJECT,
    (selectedValue) => selectedValue === null || isProjectView(selectedValue),
  )
}

export function isStateCurrentSessionReadResult(
  value: unknown,
): value is ExtensionStateCurrentSessionReadResult {
  return isSelectedStateResult(
    value,
    OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_SESSION,
    (selectedValue) => selectedValue === null || isSessionView(selectedValue),
  )
}

export function isStateCurrentBranchReadResult(
  value: unknown,
): value is ExtensionStateCurrentBranchReadResult {
  return isSelectedStateResult(
    value,
    OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_BRANCH,
    (selectedValue) => selectedValue === null || isBranchView(selectedValue),
  )
}

export function isStateRecentProjectsReadResult(
  value: unknown,
): value is ExtensionStateRecentProjectsReadResult {
  return isSelectedStateResult(
    value,
    OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.RECENT_PROJECTS,
    isStringArray,
  )
}

export function isStateModelPreferencesReadResult(
  value: unknown,
): value is ExtensionStateModelPreferencesReadResult {
  return isSelectedStateResult(
    value,
    OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.MODEL_PREFERENCES,
    isModelPreferences,
  )
}

export function isActionSelectProjectResult(
  value: unknown,
): value is ExtensionActionSelectProjectResult {
  return (
    isRecord(value) &&
    hasOpenWaggleResultBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
    ) &&
    isStringOrNull(value.previousProjectPath) &&
    isNonEmptyString(value.projectPath) &&
    isStringArray(value.recentProjects)
  )
}

function isSettingsView(value: unknown) {
  return (
    isRecord(value) &&
    isModelPreferences(value.modelPreferences) &&
    isStringRecord(value.projectDisplayNames)
  )
}

function isSettingsSelectedValue(value: unknown): value is ExtensionSettingsSelectedValue {
  if (!isRecord(value)) {
    return false
  }

  if (value.key === OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES) {
    return isModelPreferences(value.value)
  }

  return (
    value.key === OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME &&
    isNonEmptyString(value.projectPath) &&
    isStringOrNull(value.value)
  )
}

export function isSettingsGetResult(value: unknown): value is ExtensionSettingsGetResult {
  return (
    isRecord(value) &&
    hasOpenWaggleResultBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
    ) &&
    isSettingsView(value.settings)
  )
}

export function isSettingsUpdateResult(value: unknown): value is ExtensionSettingsUpdateResult {
  return (
    isRecord(value) &&
    hasOpenWaggleResultBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
    ) &&
    isSettingsView(value.settings)
  )
}

export function isSettingsGetSettingResult(
  value: unknown,
): value is ExtensionSettingsGetSettingResult {
  return (
    isRecord(value) &&
    hasOpenWaggleResultBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
    ) &&
    isSettingsSelectedValue(value.setting)
  )
}

export function isSettingsUpdateSettingResult(
  value: unknown,
): value is ExtensionSettingsUpdateSettingResult {
  return (
    isRecord(value) &&
    hasOpenWaggleResultBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
    ) &&
    isSettingsSelectedValue(value.setting)
  )
}
