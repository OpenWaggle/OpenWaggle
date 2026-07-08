import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type {
  CreateOpenWaggleSdkOptions,
  ExtensionOpenWaggleSdk,
  ExtensionOpenWaggleSettingsSdk,
  ExtensionOpenWaggleStateSdk,
  ExtensionSdkInvoke,
} from './sdk-types.js'
import type {
  ExtensionActionSelectProjectResult,
  ExtensionDocsDiscoverResult,
  ExtensionDocsResolveTopicResult,
  ExtensionSettingsGetResult,
  ExtensionSettingsGetSettingResult,
  ExtensionSettingsUpdateResult,
  ExtensionSettingsUpdateSettingResult,
  ExtensionStateCurrentBranchReadResult,
  ExtensionStateCurrentProjectReadResult,
  ExtensionStateCurrentSessionReadResult,
  ExtensionStateModelPreferencesReadResult,
  ExtensionStateReadResult,
  ExtensionStateRecentProjectsReadResult,
} from './types.js'

const unsupportedOpenExternal = async () => {
  throw new Error('OpenWaggle external URL action is not available in this extension host context.')
}

function createOpenWaggleStateSdk(invoke: ExtensionSdkInvoke): ExtensionOpenWaggleStateSdk {
  return {
    get: (scope) =>
      invoke<ExtensionStateReadResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
        scope,
        payload: {},
      }),
    readCurrentProject: (scope) =>
      invoke<ExtensionStateCurrentProjectReadResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        scope,
        payload: { selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_PROJECT },
      }),
    readCurrentSession: (scope) =>
      invoke<ExtensionStateCurrentSessionReadResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        scope,
        payload: { selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_SESSION },
      }),
    readCurrentBranch: (scope) =>
      invoke<ExtensionStateCurrentBranchReadResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        scope,
        payload: { selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_BRANCH },
      }),
    readRecentProjects: (scope) =>
      invoke<ExtensionStateRecentProjectsReadResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        scope,
        payload: { selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.RECENT_PROJECTS },
      }),
    readModelPreferences: (scope) =>
      invoke<ExtensionStateModelPreferencesReadResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
        scope,
        payload: { selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.MODEL_PREFERENCES },
      }),
  }
}

function createOpenWaggleSettingsSdk(invoke: ExtensionSdkInvoke): ExtensionOpenWaggleSettingsSdk {
  return {
    get: (scope) =>
      invoke<ExtensionSettingsGetResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
        scope,
        payload: {},
      }),
    getModelPreferences: (scope) =>
      invoke<ExtensionSettingsGetSettingResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
        scope,
        payload: { key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES },
      }),
    updateModelPreferences: (scope, value) =>
      invoke<ExtensionSettingsUpdateSettingResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
        scope,
        payload: { key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES, value },
      }),
    getProjectDisplayName: (scope, projectPath) =>
      invoke<ExtensionSettingsGetSettingResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING,
        scope,
        payload: {
          key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
          projectPath,
        },
      }),
    setProjectDisplayName: (scope, projectPath, value) =>
      invoke<ExtensionSettingsUpdateSettingResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING,
        scope,
        payload: {
          key: OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME,
          projectPath,
          value,
        },
      }),
    update: (scope, settings) =>
      invoke<ExtensionSettingsUpdateResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
        scope,
        payload: settings,
      }),
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
      selectProject: (scope, projectPath) =>
        invoke<ExtensionActionSelectProjectResult>({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
          scope,
          payload: { projectPath },
        }),
    },
    settings: createOpenWaggleSettingsSdk(invoke),
    docs: {
      discover: (scope, input = {}) =>
        invoke<ExtensionDocsDiscoverResult>({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
          scope,
          payload: input,
        }),
      resolveTopic: (scope, input) =>
        invoke<ExtensionDocsResolveTopicResult>({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
          scope,
          payload: input,
        }),
    },
  }
}
