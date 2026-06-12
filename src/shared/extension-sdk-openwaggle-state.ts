import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import {
  extensionStateCurrentBranchReadResultSchema,
  extensionStateCurrentProjectReadResultSchema,
  extensionStateCurrentSessionReadResultSchema,
  extensionStateModelPreferencesReadResultSchema,
  extensionStateReadResultSchema,
  extensionStateRecentProjectsReadResultSchema,
} from '@shared/schemas/extension-broker'
import type {
  ExtensionInvokeFailure,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
  ExtensionStateCurrentBranchReadResult,
  ExtensionStateCurrentProjectReadResult,
  ExtensionStateCurrentSessionReadResult,
  ExtensionStateModelPreferencesReadResult,
  ExtensionStateReadResult,
  ExtensionStateRecentProjectsReadResult,
} from '@shared/types/extension-broker'
import type { ExtensionOperationSuccess, ExtensionSdkInvoke } from './extension-sdk-core'
import {
  decodeWithSchema,
  openWaggleResultError,
  toDecodedOperationResult,
} from './extension-sdk-openwaggle-results'

export interface ExtensionOpenWaggleStateSdk {
  readonly get: (scope: ExtensionInvokeScope) => Promise<ExtensionStateReadOperationResult>
  readonly readCurrentProject: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionStateCurrentProjectReadOperationResult>
  readonly readCurrentSession: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionStateCurrentSessionReadOperationResult>
  readonly readCurrentBranch: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionStateCurrentBranchReadOperationResult>
  readonly readRecentProjects: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionStateRecentProjectsReadOperationResult>
  readonly readModelPreferences: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionStateModelPreferencesReadOperationResult>
}

export type ExtensionStateReadOperationResult =
  | ExtensionOperationSuccess<ExtensionStateReadResult>
  | ExtensionInvokeFailure
export type ExtensionStateCurrentProjectReadOperationResult =
  | ExtensionOperationSuccess<ExtensionStateCurrentProjectReadResult>
  | ExtensionInvokeFailure
export type ExtensionStateCurrentSessionReadOperationResult =
  | ExtensionOperationSuccess<ExtensionStateCurrentSessionReadResult>
  | ExtensionInvokeFailure
export type ExtensionStateCurrentBranchReadOperationResult =
  | ExtensionOperationSuccess<ExtensionStateCurrentBranchReadResult>
  | ExtensionInvokeFailure
export type ExtensionStateRecentProjectsReadOperationResult =
  | ExtensionOperationSuccess<ExtensionStateRecentProjectsReadResult>
  | ExtensionInvokeFailure
export type ExtensionStateModelPreferencesReadOperationResult =
  | ExtensionOperationSuccess<ExtensionStateModelPreferencesReadResult>
  | ExtensionInvokeFailure

const stateResultError = openWaggleResultError(
  'Extension broker returned an invalid OpenWaggle state result.',
)

function toStateReadResult(result: ExtensionInvokeResult): ExtensionStateReadOperationResult {
  return toDecodedOperationResult(
    result,
    decodeWithSchema(extensionStateReadResultSchema),
    stateResultError,
  )
}

function readSelectedState(input: {
  readonly invoke: ExtensionSdkInvoke
  readonly scope: ExtensionInvokeScope
  readonly selector: (typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTORS)[number]
}) {
  return input.invoke({
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE,
    scope: input.scope,
    payload: { selector: input.selector },
  })
}

export function createOpenWaggleStateSdk(invoke: ExtensionSdkInvoke): ExtensionOpenWaggleStateSdk {
  return {
    get: async (scope) =>
      toStateReadResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
          scope,
          payload: {},
        }),
      ),
    readCurrentProject: async (scope) =>
      toDecodedOperationResult(
        await readSelectedState({
          invoke,
          scope,
          selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_PROJECT,
        }),
        decodeWithSchema(extensionStateCurrentProjectReadResultSchema),
        stateResultError,
      ),
    readCurrentSession: async (scope) =>
      toDecodedOperationResult(
        await readSelectedState({
          invoke,
          scope,
          selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_SESSION,
        }),
        decodeWithSchema(extensionStateCurrentSessionReadResultSchema),
        stateResultError,
      ),
    readCurrentBranch: async (scope) =>
      toDecodedOperationResult(
        await readSelectedState({
          invoke,
          scope,
          selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.CURRENT_BRANCH,
        }),
        decodeWithSchema(extensionStateCurrentBranchReadResultSchema),
        stateResultError,
      ),
    readRecentProjects: async (scope) =>
      toDecodedOperationResult(
        await readSelectedState({
          invoke,
          scope,
          selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.RECENT_PROJECTS,
        }),
        decodeWithSchema(extensionStateRecentProjectsReadResultSchema),
        stateResultError,
      ),
    readModelPreferences: async (scope) =>
      toDecodedOperationResult(
        await readSelectedState({
          invoke,
          scope,
          selector: OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR.MODEL_PREFERENCES,
        }),
        decodeWithSchema(extensionStateModelPreferencesReadResultSchema),
        stateResultError,
      ),
  }
}
