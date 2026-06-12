import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import {
  extensionSettingsGetResultSchema,
  extensionSettingsGetSettingResultSchema,
  extensionSettingsUpdateResultSchema,
  extensionSettingsUpdateSettingResultSchema,
} from '@shared/schemas/extension-broker'
import type {
  ExtensionInvokeFailure,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
  ExtensionModelPreferencesSettingsPatch,
  ExtensionSettingsGetResult,
  ExtensionSettingsGetSettingResult,
  ExtensionSettingsUpdatePayload,
  ExtensionSettingsUpdateResult,
  ExtensionSettingsUpdateSettingResult,
} from '@shared/types/extension-broker'
import type { ExtensionOperationSuccess, ExtensionSdkInvoke } from './extension-sdk-core'
import {
  decodeWithSchema,
  openWaggleResultError,
  toDecodedOperationResult,
} from './extension-sdk-openwaggle-results'

export interface ExtensionOpenWaggleSettingsSdk {
  readonly get: (scope: ExtensionInvokeScope) => Promise<ExtensionSettingsGetOperationResult>
  readonly getModelPreferences: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionSettingsGetSettingOperationResult>
  readonly updateModelPreferences: (
    scope: ExtensionInvokeScope,
    value: ExtensionModelPreferencesSettingsPatch,
  ) => Promise<ExtensionSettingsUpdateSettingOperationResult>
  readonly getProjectDisplayName: (
    scope: ExtensionInvokeScope,
    projectPath: string,
  ) => Promise<ExtensionSettingsGetSettingOperationResult>
  readonly setProjectDisplayName: (
    scope: ExtensionInvokeScope,
    projectPath: string,
    value: string | null,
  ) => Promise<ExtensionSettingsUpdateSettingOperationResult>
  readonly update: (
    scope: ExtensionInvokeScope,
    settings: ExtensionSettingsUpdatePayload,
  ) => Promise<ExtensionSettingsUpdateOperationResult>
}

export type ExtensionSettingsGetOperationResult =
  | ExtensionOperationSuccess<ExtensionSettingsGetResult>
  | ExtensionInvokeFailure
export type ExtensionSettingsGetSettingOperationResult =
  | ExtensionOperationSuccess<ExtensionSettingsGetSettingResult>
  | ExtensionInvokeFailure
export type ExtensionSettingsUpdateOperationResult =
  | ExtensionOperationSuccess<ExtensionSettingsUpdateResult>
  | ExtensionInvokeFailure
export type ExtensionSettingsUpdateSettingOperationResult =
  | ExtensionOperationSuccess<ExtensionSettingsUpdateSettingResult>
  | ExtensionInvokeFailure

const settingsResultError = openWaggleResultError(
  'Extension broker returned an invalid OpenWaggle settings result.',
)

function toSettingsGetResult(result: ExtensionInvokeResult): ExtensionSettingsGetOperationResult {
  return toDecodedOperationResult(
    result,
    decodeWithSchema(extensionSettingsGetResultSchema),
    settingsResultError,
  )
}

function toSettingsUpdateResult(
  result: ExtensionInvokeResult,
): ExtensionSettingsUpdateOperationResult {
  return toDecodedOperationResult(
    result,
    decodeWithSchema(extensionSettingsUpdateResultSchema),
    settingsResultError,
  )
}

function toSettingsGetSettingResult(
  result: ExtensionInvokeResult,
): ExtensionSettingsGetSettingOperationResult {
  return toDecodedOperationResult(
    result,
    decodeWithSchema(extensionSettingsGetSettingResultSchema),
    settingsResultError,
  )
}

function toSettingsUpdateSettingResult(
  result: ExtensionInvokeResult,
): ExtensionSettingsUpdateSettingOperationResult {
  return toDecodedOperationResult(
    result,
    decodeWithSchema(extensionSettingsUpdateSettingResultSchema),
    settingsResultError,
  )
}

export function createOpenWaggleSettingsSdk(
  invoke: ExtensionSdkInvoke,
): ExtensionOpenWaggleSettingsSdk {
  return {
    get: async (scope) =>
      toSettingsGetResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
          scope,
          payload: {},
        }),
      ),
    getModelPreferences: async (scope) =>
      toSettingsGetSettingResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
          scope,
          payload: { key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES },
        }),
      ),
    updateModelPreferences: async (scope, value) =>
      toSettingsUpdateSettingResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
          scope,
          payload: { key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES, value },
        }),
      ),
    getProjectDisplayName: async (scope, projectPath) =>
      toSettingsGetSettingResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
          scope,
          payload: {
            key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
            projectPath,
          },
        }),
      ),
    setProjectDisplayName: async (scope, projectPath, value) =>
      toSettingsUpdateSettingResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
          scope,
          payload: {
            key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
            projectPath,
            value,
          },
        }),
      ),
    update: async (scope, settings) =>
      toSettingsUpdateResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
          scope,
          payload: settings,
        }),
      ),
  }
}
