import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { EXTENSION_FRAME_SURFACE_ACTION } from '@shared/constants/extension-frame'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionSdkInvokeRequest } from '@shared/extension-sdk-core'
import type {
  ExtensionSelectProjectOperationResult,
  ExtensionSettingsGetOperationResult,
  ExtensionSettingsUpdateOperationResult,
  ExtensionStateReadOperationResult,
} from '@shared/extension-sdk-openwaggle'
import type {
  ExtensionPackageStorageKindSdk,
  ExtensionPackageStorageSdk,
  ExtensionStorageDeleteOperationResult,
  ExtensionStorageGetOperationResult,
  ExtensionStorageListOperationResult,
  ExtensionStorageScopeSdk,
  ExtensionStorageSetOperationResult,
} from '@shared/extension-sdk-storage'
import type {
  ExtensionInvokeResult,
  ExtensionInvokeScope,
  ExtensionSettingsUpdatePayload,
  ExtensionStorageKind,
  ExtensionStorageScopeSelector,
} from '@shared/types/extension-broker'
import type { JsonValue } from '@shared/types/json'
import type { OpenWaggleExtensionMountContext } from './extension-federated-module'
import {
  isSelectProjectResult,
  isSettingsGetResult,
  isSettingsUpdateResult,
  isStateReadResult,
  isStorageDeleteResult,
  isStorageGetResult,
  isStorageListResult,
  isStorageSetResult,
  operationResult,
} from './extension-frame-bootstrap-results'

type ExtensionFrameSdk = OpenWaggleExtensionMountContext['sdk']
type FramePost = (
  message:
    | { readonly type: 'open-external'; readonly url: string }
    | { readonly type: 'surface-action'; readonly actionId: string; readonly payload?: JsonValue },
) => void

function storagePayload(
  storageKind: ExtensionStorageKind,
  storageScope: ExtensionStorageScopeSelector,
  key?: string,
  value?: JsonValue,
) {
  return {
    storageKind,
    storageScope,
    ...(key !== undefined ? { key } : {}),
    ...(value !== undefined ? { value } : {}),
  }
}

function createStorageScopeSdk(
  invokeBroker: (input: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>,
  storageKind: ExtensionStorageKind,
  storageScope: ExtensionStorageScopeSelector,
): ExtensionStorageScopeSdk {
  return {
    get: async (scope, key): Promise<ExtensionStorageGetOperationResult> =>
      operationResult(
        await invokeBroker({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
          scope,
          payload: storagePayload(storageKind, storageScope, key),
        }),
        isStorageGetResult,
        'Extension broker returned an invalid storage get result.',
      ),
    set: async (scope, key, value): Promise<ExtensionStorageSetOperationResult> =>
      operationResult(
        await invokeBroker({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
          scope,
          payload: storagePayload(storageKind, storageScope, key, value),
        }),
        isStorageSetResult,
        'Extension broker returned an invalid storage set result.',
      ),
    delete: async (scope, key): Promise<ExtensionStorageDeleteOperationResult> =>
      operationResult(
        await invokeBroker({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
          scope,
          payload: storagePayload(storageKind, storageScope, key),
        }),
        isStorageDeleteResult,
        'Extension broker returned an invalid storage delete result.',
      ),
    list: async (scope): Promise<ExtensionStorageListOperationResult> =>
      operationResult(
        await invokeBroker({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
          scope,
          payload: storagePayload(storageKind, storageScope),
        }),
        isStorageListResult,
        'Extension broker returned an invalid storage list result.',
      ),
  }
}

function createStorageKindSdk(
  invokeBroker: (input: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>,
  storageKind: ExtensionStorageKind,
): ExtensionPackageStorageKindSdk {
  return {
    global: createStorageScopeSdk(
      invokeBroker,
      storageKind,
      OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
    ),
    project: createStorageScopeSdk(
      invokeBroker,
      storageKind,
      OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
    ),
  }
}

function createFramePackageStorageSdk(
  invokeBroker: (input: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>,
): ExtensionPackageStorageSdk {
  return {
    packageState: createStorageKindSdk(invokeBroker, OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE),
    packageConfig: createStorageKindSdk(invokeBroker, OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG),
  }
}

function createFrameOpenWaggleSdk(
  invokeBroker: (input: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>,
  post: FramePost,
) {
  return {
    state: {
      get: async (scope: ExtensionInvokeScope): Promise<ExtensionStateReadOperationResult> =>
        operationResult(
          await invokeBroker({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
            scope,
            payload: {},
          }),
          isStateReadResult,
          'Extension broker returned an invalid OpenWaggle state result.',
        ),
    },
    actions: {
      selectProject: async (
        scope: ExtensionInvokeScope,
        projectPath: string,
      ): Promise<ExtensionSelectProjectOperationResult> =>
        operationResult(
          await invokeBroker({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
            scope,
            payload: { projectPath },
          }),
          isSelectProjectResult,
          'Extension broker returned an invalid OpenWaggle action result.',
        ),
      openExternal: (url: string) => {
        post({ type: 'open-external', url })
        return Promise.resolve()
      },
    },
    settings: {
      get: async (scope: ExtensionInvokeScope): Promise<ExtensionSettingsGetOperationResult> =>
        operationResult(
          await invokeBroker({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
            scope,
            payload: {},
          }),
          isSettingsGetResult,
          'Extension broker returned an invalid OpenWaggle settings result.',
        ),
      update: async (
        scope: ExtensionInvokeScope,
        settings: ExtensionSettingsUpdatePayload,
      ): Promise<ExtensionSettingsUpdateOperationResult> =>
        operationResult(
          await invokeBroker({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
            scope,
            payload: settings,
          }),
          isSettingsUpdateResult,
          'Extension broker returned an invalid OpenWaggle settings result.',
        ),
    },
  }
}

export function createFrameExtensionSdk(input: {
  readonly invokeBroker: (input: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>
  readonly post: FramePost
}): ExtensionFrameSdk {
  return {
    invoke: input.invokeBroker,
    hostContext: {
      getScope: (scope) =>
        input.invokeBroker({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          scope,
          payload: {},
        }),
    },
    storage: createFramePackageStorageSdk(input.invokeBroker),
    openWaggle: createFrameOpenWaggleSdk(input.invokeBroker, input.post),
    surface: {
      sendAction: (actionId, payload) => {
        input.post(
          payload === undefined
            ? { type: 'surface-action', actionId }
            : { type: 'surface-action', actionId, payload },
        )
        return Promise.resolve()
      },
      respondInteraction: (value) => {
        input.post({
          type: 'surface-action',
          actionId: EXTENSION_FRAME_SURFACE_ACTION.CUSTOM_INTERACTION_RESPONSE,
          payload: value,
        })
        return Promise.resolve()
      },
    },
  }
}
