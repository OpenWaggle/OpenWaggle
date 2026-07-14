import { toDecodedOperationResult } from './broker-validation.js'
import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { isDocsDiscoverResult, isDocsResolveTopicResult } from './docs-validation.js'
import {
  isActionSelectProjectResult,
  isSettingsGetResult,
  isSettingsGetSettingResult,
  isSettingsUpdateResult,
  isSettingsUpdateSettingResult,
  isStateCurrentBranchReadResult,
  isStateCurrentProjectReadResult,
  isStateCurrentSessionReadResult,
  isStateModelPreferencesReadResult,
  isStateReadResult,
  isStateRecentProjectsReadResult,
} from './openwaggle-validation.js'
import type {
  CreateOpenWaggleSdkOptions,
  ExtensionOpenWaggleSdk,
  ExtensionOpenWaggleSettingsSdk,
  ExtensionOpenWaggleStateSdk,
  ExtensionSdkInvoke,
} from './sdk-types.js'

const ACTION_RESULT_ERROR = 'Extension broker returned an invalid OpenWaggle action result.'
const DOCS_RESULT_ERROR = 'Extension broker returned an invalid OpenWaggle docs result.'
const SETTINGS_RESULT_ERROR = 'Extension broker returned an invalid OpenWaggle settings result.'
const STATE_RESULT_ERROR = 'Extension broker returned an invalid OpenWaggle state result.'

const unsupportedOpenExternal = async () => {
  throw new Error('OpenWaggle external URL action is not available in this extension host context.')
}

function createOpenWaggleStateSdk(invoke: ExtensionSdkInvoke): ExtensionOpenWaggleStateSdk {
  return {
    get: async (scope) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
          scope,
          payload: {},
        }),
        isStateReadResult,
        STATE_RESULT_ERROR,
      ),
    readCurrentProject: async (scope) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
          scope,
          payload: { selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_PROJECT },
        }),
        isStateCurrentProjectReadResult,
        STATE_RESULT_ERROR,
      ),
    readCurrentSession: async (scope) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
          scope,
          payload: { selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_SESSION },
        }),
        isStateCurrentSessionReadResult,
        STATE_RESULT_ERROR,
      ),
    readCurrentBranch: async (scope) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
          scope,
          payload: { selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_BRANCH },
        }),
        isStateCurrentBranchReadResult,
        STATE_RESULT_ERROR,
      ),
    readRecentProjects: async (scope) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
          scope,
          payload: { selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.RECENT_PROJECTS },
        }),
        isStateRecentProjectsReadResult,
        STATE_RESULT_ERROR,
      ),
    readModelPreferences: async (scope) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
          scope,
          payload: { selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.MODEL_PREFERENCES },
        }),
        isStateModelPreferencesReadResult,
        STATE_RESULT_ERROR,
      ),
  }
}

function createOpenWaggleSettingsSdk(invoke: ExtensionSdkInvoke): ExtensionOpenWaggleSettingsSdk {
  return {
    get: async (scope) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
          scope,
          payload: {},
        }),
        isSettingsGetResult,
        SETTINGS_RESULT_ERROR,
      ),
    getModelPreferences: async (scope) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
          scope,
          payload: { key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES },
        }),
        isSettingsGetSettingResult,
        SETTINGS_RESULT_ERROR,
      ),
    updateModelPreferences: async (scope, value) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
          scope,
          payload: { key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES, value },
        }),
        isSettingsUpdateSettingResult,
        SETTINGS_RESULT_ERROR,
      ),
    getProjectDisplayName: async (scope, projectPath) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
          scope,
          payload: {
            key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
            projectPath,
          },
        }),
        isSettingsGetSettingResult,
        SETTINGS_RESULT_ERROR,
      ),
    setProjectDisplayName: async (scope, projectPath, value) =>
      toDecodedOperationResult(
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
        isSettingsUpdateSettingResult,
        SETTINGS_RESULT_ERROR,
      ),
    update: async (scope, settings) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
          scope,
          payload: settings,
        }),
        isSettingsUpdateResult,
        SETTINGS_RESULT_ERROR,
      ),
  }
}

export function createOpenWaggleSdk(
  invoke: ExtensionSdkInvoke,
  options: CreateOpenWaggleSdkOptions = {},
): ExtensionOpenWaggleSdk {
  return {
    state: createOpenWaggleStateSdk(invoke),
    actions: {
      openExternal: options.openExternal ?? unsupportedOpenExternal,
      selectProject: async (scope, projectPath) =>
        toDecodedOperationResult(
          await invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
            scope,
            payload: { projectPath },
          }),
          isActionSelectProjectResult,
          ACTION_RESULT_ERROR,
        ),
    },
    settings: createOpenWaggleSettingsSdk(invoke),
    docs: {
      discover: async (scope, input = {}) =>
        toDecodedOperationResult(
          await invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
            scope,
            payload: input,
          }),
          isDocsDiscoverResult,
          DOCS_RESULT_ERROR,
        ),
      resolveTopic: async (scope, input) =>
        toDecodedOperationResult(
          await invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
            scope,
            payload: input,
          }),
          isDocsResolveTopicResult,
          DOCS_RESULT_ERROR,
        ),
    },
  }
}
