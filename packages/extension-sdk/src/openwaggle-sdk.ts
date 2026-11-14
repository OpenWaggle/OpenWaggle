import * as Schema from 'effect/Schema'
import { toDecodedOperationResult } from './broker-validation.js'
import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { extensionDocsDiscoverResultSchema, extensionDocsResolveTopicResultSchema } from './docs.js'
import {
  actionSelectProjectResultSchema,
  sessionResourcePublishResultSchema,
  sessionResourcesListResultSchema,
  settingsGetResultSchema,
  settingsGetSettingResultSchema,
  settingsUpdateResultSchema,
  settingsUpdateSettingResultSchema,
  stateCurrentBranchReadResultSchema,
  stateCurrentProjectReadResultSchema,
  stateCurrentSessionReadResultSchema,
  stateModelPreferencesReadResultSchema,
  stateReadResultSchema,
  stateRecentProjectsReadResultSchema,
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
const RESOURCE_RESULT_ERROR = 'Extension broker returned an invalid session resource result.'

/** A resource result for the Session the request named, and no other. */
function forSession<TValue extends { readonly sessionId: string }, TEncoded>(
  schema: Schema.Schema<TValue, TEncoded>,
  sessionId: string,
) {
  return schema.pipe(
    Schema.filter(
      (value) =>
        value.sessionId === sessionId || {
          path: ['sessionId'],
          message: 'Must be the Session the request named.',
        },
    ),
  )
}

const unsupportedOpenExternal = async () => {
  throw new Error('OpenWaggle external URL action is not available in this extension host context.')
}

function createOpenWaggleStateSdk(invoke: ExtensionSdkInvoke) {
  const sdk: ExtensionOpenWaggleStateSdk = {
    get: async (scope) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
          scope,
          payload: {},
        }),
        stateReadResultSchema,
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
        stateCurrentProjectReadResultSchema,
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
        stateCurrentSessionReadResultSchema,
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
        stateCurrentBranchReadResultSchema,
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
        stateRecentProjectsReadResultSchema,
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
        stateModelPreferencesReadResultSchema,
        STATE_RESULT_ERROR,
      ),
  }
  return sdk
}

function createOpenWaggleSettingsSdk(invoke: ExtensionSdkInvoke) {
  const sdk: ExtensionOpenWaggleSettingsSdk = {
    get: async (scope) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
          scope,
          payload: {},
        }),
        settingsGetResultSchema,
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
        settingsGetSettingResultSchema,
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
        settingsUpdateSettingResultSchema,
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
        settingsGetSettingResultSchema,
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
        settingsUpdateSettingResultSchema,
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
        settingsUpdateResultSchema,
        SETTINGS_RESULT_ERROR,
      ),
  }
  return sdk
}

export function createOpenWaggleSdk(
  invoke: ExtensionSdkInvoke,
  options: CreateOpenWaggleSdkOptions = {},
) {
  const sdk: ExtensionOpenWaggleSdk = {
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
          actionSelectProjectResultSchema,
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
          extensionDocsDiscoverResultSchema,
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
          extensionDocsResolveTopicResultSchema,
          DOCS_RESULT_ERROR,
        ),
    },
    resources: {
      list: async (scope, input = {}) =>
        toDecodedOperationResult(
          await invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES,
            scope,
            payload: input,
          }),
          forSession(sessionResourcesListResultSchema, scope.sessionId),
          RESOURCE_RESULT_ERROR,
        ),
      publish: async (scope, resource) =>
        toDecodedOperationResult(
          await invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_RESOURCE,
            scope,
            payload: resource,
          }),
          forSession(sessionResourcePublishResultSchema, scope.sessionId),
          RESOURCE_RESULT_ERROR,
        ),
    },
  }
  return sdk
}
