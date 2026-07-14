import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { extensionActionSelectProjectResultSchema } from '@shared/schemas/extension-broker'
import {
  extensionDocsDiscoverResultSchema,
  extensionDocsResolveTopicResultSchema,
} from '@shared/schemas/extension-broker-docs'
import type {
  ExtensionActionSelectProjectResult,
  ExtensionDocsDiscoverPayload,
  ExtensionDocsDiscoverResult,
  ExtensionDocsResolveTopicPayload,
  ExtensionDocsResolveTopicResult,
  ExtensionInvokeFailure,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
} from '@shared/types/extension-broker'
import type { ExtensionOperationSuccess, ExtensionSdkInvoke } from './extension-sdk-core'
import {
  decodeWithSchema,
  openWaggleResultError,
  toDecodedOperationResult,
} from './extension-sdk-openwaggle-results'
import {
  createOpenWaggleSettingsSdk,
  type ExtensionOpenWaggleSettingsSdk,
} from './extension-sdk-openwaggle-settings'
import {
  createOpenWaggleStateSdk,
  type ExtensionOpenWaggleStateSdk,
} from './extension-sdk-openwaggle-state'

export type {
  ExtensionOpenWaggleSettingsSdk,
  ExtensionSettingsGetOperationResult,
  ExtensionSettingsGetSettingOperationResult,
  ExtensionSettingsUpdateOperationResult,
  ExtensionSettingsUpdateSettingOperationResult,
} from './extension-sdk-openwaggle-settings'
export type {
  ExtensionOpenWaggleStateSdk,
  ExtensionStateCurrentBranchReadOperationResult,
  ExtensionStateCurrentProjectReadOperationResult,
  ExtensionStateCurrentSessionReadOperationResult,
  ExtensionStateModelPreferencesReadOperationResult,
  ExtensionStateReadOperationResult,
  ExtensionStateRecentProjectsReadOperationResult,
} from './extension-sdk-openwaggle-state'

export interface ExtensionOpenWaggleSdk {
  readonly state: ExtensionOpenWaggleStateSdk
  readonly actions: {
    readonly selectProject: (
      scope: ExtensionInvokeScope,
      projectPath: string,
    ) => Promise<ExtensionSelectProjectOperationResult>
    readonly openExternal: (url: string) => Promise<void>
  }
  readonly settings: ExtensionOpenWaggleSettingsSdk
  readonly docs: {
    readonly discover: (
      scope: ExtensionInvokeScope,
      input?: ExtensionDocsDiscoverPayload,
    ) => Promise<ExtensionDocsDiscoverOperationResult>
    readonly resolveTopic: (
      scope: ExtensionInvokeScope,
      input: ExtensionDocsResolveTopicPayload,
    ) => Promise<ExtensionDocsResolveTopicOperationResult>
  }
}

export type ExtensionSelectProjectOperationResult =
  | ExtensionOperationSuccess<ExtensionActionSelectProjectResult>
  | ExtensionInvokeFailure
export type ExtensionDocsDiscoverOperationResult =
  | ExtensionOperationSuccess<ExtensionDocsDiscoverResult>
  | ExtensionInvokeFailure
export type ExtensionDocsResolveTopicOperationResult =
  | ExtensionOperationSuccess<ExtensionDocsResolveTopicResult>
  | ExtensionInvokeFailure

export interface CreateOpenWaggleSdkOptions {
  readonly openExternal?: (url: string) => Promise<void>
}

const unsupportedOpenExternal = async () => {
  throw new Error('OpenWaggle external URL action is not available in this extension host context.')
}

const actionResultError = openWaggleResultError(
  'Extension broker returned an invalid OpenWaggle action result.',
)
const docsResultError = openWaggleResultError(
  'Extension broker returned an invalid OpenWaggle docs result.',
)

function toSelectProjectResult(
  result: ExtensionInvokeResult,
): ExtensionSelectProjectOperationResult {
  return toDecodedOperationResult(
    result,
    decodeWithSchema(extensionActionSelectProjectResultSchema),
    actionResultError,
  )
}

function toDocsDiscoverResult(result: ExtensionInvokeResult): ExtensionDocsDiscoverOperationResult {
  return toDecodedOperationResult(
    result,
    decodeWithSchema(extensionDocsDiscoverResultSchema),
    docsResultError,
  )
}

function toDocsResolveTopicResult(
  result: ExtensionInvokeResult,
): ExtensionDocsResolveTopicOperationResult {
  return toDecodedOperationResult(
    result,
    decodeWithSchema(extensionDocsResolveTopicResultSchema),
    docsResultError,
  )
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
        toSelectProjectResult(
          await invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
            scope,
            payload: { projectPath },
          }),
        ),
    },
    settings: createOpenWaggleSettingsSdk(invoke),
    docs: {
      discover: async (scope, input = {}) =>
        toDocsDiscoverResult(
          await invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS,
            scope,
            payload: input,
          }),
        ),
      resolveTopic: async (scope, input) =>
        toDocsResolveTopicResult(
          await invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC,
            scope,
            payload: input,
          }),
        ),
    },
  }
}
