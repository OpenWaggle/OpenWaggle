import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionActionSelectProjectResultSchema,
  extensionSettingsGetResultSchema,
  extensionSettingsUpdateResultSchema,
  extensionStateReadResultSchema,
} from '@shared/schemas/extension-broker'
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
  ExtensionSettingsGetResult,
  ExtensionSettingsUpdatePayload,
  ExtensionSettingsUpdateResult,
  ExtensionStateReadResult,
} from '@shared/types/extension-broker'
import type { ExtensionOperationSuccess, ExtensionSdkInvoke } from './extension-sdk-core'
import { invalidOperationResult } from './extension-sdk-core'

export interface ExtensionOpenWaggleSdk {
  readonly state: {
    readonly get: (scope: ExtensionInvokeScope) => Promise<ExtensionStateReadOperationResult>
  }
  readonly actions: {
    readonly selectProject: (
      scope: ExtensionInvokeScope,
      projectPath: string,
    ) => Promise<ExtensionSelectProjectOperationResult>
    readonly openExternal: (url: string) => Promise<void>
  }
  readonly settings: {
    readonly get: (scope: ExtensionInvokeScope) => Promise<ExtensionSettingsGetOperationResult>
    readonly update: (
      scope: ExtensionInvokeScope,
      settings: ExtensionSettingsUpdatePayload,
    ) => Promise<ExtensionSettingsUpdateOperationResult>
  }
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

export type ExtensionStateReadOperationResult =
  | ExtensionOperationSuccess<ExtensionStateReadResult>
  | ExtensionInvokeFailure

export type ExtensionSelectProjectOperationResult =
  | ExtensionOperationSuccess<ExtensionActionSelectProjectResult>
  | ExtensionInvokeFailure

export type ExtensionSettingsGetOperationResult =
  | ExtensionOperationSuccess<ExtensionSettingsGetResult>
  | ExtensionInvokeFailure

export type ExtensionSettingsUpdateOperationResult =
  | ExtensionOperationSuccess<ExtensionSettingsUpdateResult>
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

function stateResultError(input: {
  readonly result: ExtensionInvokeResult & { readonly ok: true }
  readonly issues: readonly string[]
}) {
  return invalidOperationResult({
    audit: input.result.audit,
    issues: input.issues,
    message: 'Extension broker returned an invalid OpenWaggle state result.',
  })
}

function actionResultError(input: {
  readonly result: ExtensionInvokeResult & { readonly ok: true }
  readonly issues: readonly string[]
}) {
  return invalidOperationResult({
    audit: input.result.audit,
    issues: input.issues,
    message: 'Extension broker returned an invalid OpenWaggle action result.',
  })
}

function settingsResultError(input: {
  readonly result: ExtensionInvokeResult & { readonly ok: true }
  readonly issues: readonly string[]
}) {
  return invalidOperationResult({
    audit: input.result.audit,
    issues: input.issues,
    message: 'Extension broker returned an invalid OpenWaggle settings result.',
  })
}

function docsResultError(input: {
  readonly result: ExtensionInvokeResult & { readonly ok: true }
  readonly issues: readonly string[]
}) {
  return invalidOperationResult({
    audit: input.result.audit,
    issues: input.issues,
    message: 'Extension broker returned an invalid OpenWaggle docs result.',
  })
}

function toStateReadResult(result: ExtensionInvokeResult): ExtensionStateReadOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionStateReadResultSchema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : stateResultError({ result, issues: decoded.issues })
}

function toSelectProjectResult(
  result: ExtensionInvokeResult,
): ExtensionSelectProjectOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionActionSelectProjectResultSchema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : actionResultError({ result, issues: decoded.issues })
}

function toSettingsGetResult(result: ExtensionInvokeResult): ExtensionSettingsGetOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionSettingsGetResultSchema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : settingsResultError({ result, issues: decoded.issues })
}

function toSettingsUpdateResult(
  result: ExtensionInvokeResult,
): ExtensionSettingsUpdateOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionSettingsUpdateResultSchema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : settingsResultError({ result, issues: decoded.issues })
}

function toDocsDiscoverResult(result: ExtensionInvokeResult): ExtensionDocsDiscoverOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionDocsDiscoverResultSchema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : docsResultError({ result, issues: decoded.issues })
}

function toDocsResolveTopicResult(
  result: ExtensionInvokeResult,
): ExtensionDocsResolveTopicOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionDocsResolveTopicResultSchema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : docsResultError({ result, issues: decoded.issues })
}

export function createOpenWaggleSdk(
  invoke: ExtensionSdkInvoke,
  options: CreateOpenWaggleSdkOptions = {},
): ExtensionOpenWaggleSdk {
  return {
    state: {
      get: async (scope) =>
        toStateReadResult(
          await invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
            scope,
            payload: {},
          }),
        ),
    },
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
    settings: {
      get: async (scope) =>
        toSettingsGetResult(
          await invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
            scope,
            payload: {},
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
    },
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
