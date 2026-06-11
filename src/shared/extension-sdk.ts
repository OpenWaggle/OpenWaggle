import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeResult, ExtensionInvokeScope } from '@shared/types/extension-broker'
import {
  type ExtensionBrokerTransport,
  type ExtensionSdkIdentity,
  type ExtensionSdkInvoke,
  type ExtensionSdkInvokeRequest,
  toInvokeInput,
} from './extension-sdk-core'
import {
  type CreateOpenWaggleSdkOptions,
  createOpenWaggleSdk,
  type ExtensionOpenWaggleSdk,
} from './extension-sdk-openwaggle'
import { createPackageStorageSdk, type ExtensionPackageStorageSdk } from './extension-sdk-storage'

export type {
  CreateOpenWaggleExtensionSurfaceContextInput,
  OpenWaggleExtensionMountCleanup,
  OpenWaggleExtensionMountContext,
  OpenWaggleExtensionMountResult,
  OpenWaggleExtensionSdk,
  OpenWaggleExtensionSurfaceContext,
  OpenWaggleExtensionSurfaceSdk,
  OpenWaggleFederatedModule,
} from './extension-context'
export {
  createNoopExtensionSurfaceSdk,
  createOpenWaggleExtensionSurfaceContext,
} from './extension-context'
export type {
  ExtensionBrokerTransport,
  ExtensionOperationSuccess,
  ExtensionSdkIdentity,
  ExtensionSdkInvoke,
  ExtensionSdkInvokeRequest,
} from './extension-sdk-core'
export type {
  CreateOpenWaggleSdkOptions,
  ExtensionDocsDiscoverOperationResult,
  ExtensionDocsResolveTopicOperationResult,
  ExtensionOpenWaggleSdk,
  ExtensionSelectProjectOperationResult,
  ExtensionSettingsGetOperationResult,
  ExtensionSettingsUpdateOperationResult,
  ExtensionStateReadOperationResult,
} from './extension-sdk-openwaggle'
export type {
  ExtensionPackageStorageKindSdk,
  ExtensionPackageStorageSdk,
  ExtensionStorageDeleteOperationResult,
  ExtensionStorageGetOperationResult,
  ExtensionStorageListOperationResult,
  ExtensionStorageScopeSdk,
  ExtensionStorageSetOperationResult,
} from './extension-sdk-storage'
export type {
  CreateOpenWaggleExtensionThemeOptions,
  ExtensionThemeCssVariableResolver,
  OpenWaggleExtensionColorScheme,
  OpenWaggleExtensionTheme,
  OpenWaggleExtensionThemeCssVariableEntry,
  OpenWaggleExtensionThemeCssVariables,
  OpenWaggleExtensionThemeTokens,
} from './extension-theme'
export {
  createOpenWaggleExtensionTheme,
  extensionThemeCssVariableEntries,
  isOpenWaggleExtensionTheme,
  OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES,
} from './extension-theme'
export type {
  CreateOpenWaggleExtensionUiStylesheetOptions,
  OpenWaggleExtensionClassNamePart,
  OpenWaggleExtensionUiButtonVariant,
  OpenWaggleExtensionUiTone,
} from './extension-ui'
export {
  createOpenWaggleExtensionUiStylesheet,
  extensionThemeCssVariableDeclarations,
  OPENWAGGLE_EXTENSION_UI_ATTRIBUTES,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES,
  openWaggleExtensionClassName,
} from './extension-ui'

export interface ExtensionBrokerSdk {
  readonly invoke: (request: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>
  readonly hostContext: {
    readonly getScope: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult>
  }
  readonly storage: ExtensionPackageStorageSdk
  readonly openWaggle: ExtensionOpenWaggleSdk
}

export function createExtensionBrokerSdkFromInvoke(
  invoke: ExtensionSdkInvoke,
  options: CreateOpenWaggleSdkOptions = {},
): ExtensionBrokerSdk {
  return {
    invoke,
    hostContext: {
      getScope: (scope) =>
        invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          scope,
          payload: {},
        }),
    },
    storage: createPackageStorageSdk(invoke),
    openWaggle: createOpenWaggleSdk(invoke, options),
  }
}

export function createExtensionBrokerSdk(
  transport: ExtensionBrokerTransport,
  identity: ExtensionSdkIdentity,
): ExtensionBrokerSdk {
  const invoke = (request: ExtensionSdkInvokeRequest) => transport(toInvokeInput(identity, request))

  return createExtensionBrokerSdkFromInvoke(invoke)
}
