import type { JsonValue } from './json.js'
import type {
  ExtensionActionSelectProjectResult,
  ExtensionDocsDiscoverPayload,
  ExtensionDocsDiscoverResult,
  ExtensionDocsResolveTopicPayload,
  ExtensionDocsResolveTopicResult,
  ExtensionInvokeFailure,
  ExtensionInvokeInput,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
  ExtensionInvokeSuccess,
  ExtensionModelPreferencesSettingsPatch,
  ExtensionRuntimeRegisterContributionPayload,
  ExtensionRuntimeRegisterContributionResult,
  ExtensionRuntimeUnregisterContributionPayload,
  ExtensionRuntimeUnregisterContributionResult,
  ExtensionSettingsGetResult,
  ExtensionSettingsGetSettingResult,
  ExtensionSettingsUpdatePayload,
  ExtensionSettingsUpdateResult,
  ExtensionSettingsUpdateSettingResult,
  ExtensionStateCurrentBranchReadResult,
  ExtensionStateCurrentProjectReadResult,
  ExtensionStateCurrentSessionReadResult,
  ExtensionStateModelPreferencesReadResult,
  ExtensionStateReadResult,
  ExtensionStateRecentProjectsReadResult,
  ExtensionStorageDeleteResult,
  ExtensionStorageGetResult,
  ExtensionStorageListResult,
  ExtensionStorageSetResult,
} from './types.js'

export type ExtensionOperationSuccess<TValue> = ExtensionInvokeSuccess<TValue>
export type ExtensionStorageGetOperationResult =
  | ExtensionOperationSuccess<ExtensionStorageGetResult>
  | ExtensionInvokeFailure
export type ExtensionStorageSetOperationResult =
  | ExtensionOperationSuccess<ExtensionStorageSetResult>
  | ExtensionInvokeFailure
export type ExtensionStorageDeleteOperationResult =
  | ExtensionOperationSuccess<ExtensionStorageDeleteResult>
  | ExtensionInvokeFailure
export type ExtensionStorageListOperationResult =
  | ExtensionOperationSuccess<ExtensionStorageListResult>
  | ExtensionInvokeFailure
export type ExtensionRuntimeRegisterContributionOperationResult =
  | ExtensionOperationSuccess<ExtensionRuntimeRegisterContributionResult>
  | ExtensionInvokeFailure
export type ExtensionRuntimeUnregisterContributionOperationResult =
  | ExtensionOperationSuccess<ExtensionRuntimeUnregisterContributionResult>
  | ExtensionInvokeFailure
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
export type ExtensionSelectProjectOperationResult =
  | ExtensionOperationSuccess<ExtensionActionSelectProjectResult>
  | ExtensionInvokeFailure
export type ExtensionDocsDiscoverOperationResult =
  | ExtensionOperationSuccess<ExtensionDocsDiscoverResult>
  | ExtensionInvokeFailure
export type ExtensionDocsResolveTopicOperationResult =
  | ExtensionOperationSuccess<ExtensionDocsResolveTopicResult>
  | ExtensionInvokeFailure
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

export interface ExtensionSdkIdentity {
  readonly extensionId: string
  readonly contributionId: string
}

export interface ExtensionSdkInvokeRequest {
  readonly capability: string
  readonly method: string
  readonly scope: ExtensionInvokeScope
  readonly payload?: unknown
}

export type ExtensionBrokerTransport = (
  input: ExtensionInvokeInput,
) => Promise<ExtensionInvokeResult>

export type ExtensionSdkInvoke = (
  request: ExtensionSdkInvokeRequest,
) => Promise<ExtensionInvokeResult>

export interface ExtensionStorageScopeSdk {
  readonly get: (
    scope: ExtensionInvokeScope,
    key: string,
  ) => Promise<ExtensionInvokeResult<ExtensionStorageGetResult>>
  readonly set: (
    scope: ExtensionInvokeScope,
    key: string,
    value: JsonValue,
  ) => Promise<ExtensionInvokeResult<ExtensionStorageSetResult>>
  readonly delete: (
    scope: ExtensionInvokeScope,
    key: string,
  ) => Promise<ExtensionInvokeResult<ExtensionStorageDeleteResult>>
  readonly list: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionInvokeResult<ExtensionStorageListResult>>
}

export interface ExtensionPackageStorageKindSdk {
  readonly global: ExtensionStorageScopeSdk
  readonly project: ExtensionStorageScopeSdk
}

export interface ExtensionPackageStorageSdk {
  readonly packageState: ExtensionPackageStorageKindSdk
  readonly packageConfig: ExtensionPackageStorageKindSdk
}

export interface ExtensionOpenWaggleStateSdk {
  readonly get: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionInvokeResult<ExtensionStateReadResult>>
  readonly readCurrentProject: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionInvokeResult<ExtensionStateCurrentProjectReadResult>>
  readonly readCurrentSession: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionInvokeResult<ExtensionStateCurrentSessionReadResult>>
  readonly readCurrentBranch: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionInvokeResult<ExtensionStateCurrentBranchReadResult>>
  readonly readRecentProjects: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionInvokeResult<ExtensionStateRecentProjectsReadResult>>
  readonly readModelPreferences: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionInvokeResult<ExtensionStateModelPreferencesReadResult>>
}

export interface ExtensionOpenWaggleSettingsSdk {
  readonly get: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionInvokeResult<ExtensionSettingsGetResult>>
  readonly getModelPreferences: (
    scope: ExtensionInvokeScope,
  ) => Promise<ExtensionInvokeResult<ExtensionSettingsGetSettingResult>>
  readonly updateModelPreferences: (
    scope: ExtensionInvokeScope,
    value: ExtensionModelPreferencesSettingsPatch,
  ) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateSettingResult>>
  readonly getProjectDisplayName: (
    scope: ExtensionInvokeScope,
    projectPath: string,
  ) => Promise<ExtensionInvokeResult<ExtensionSettingsGetSettingResult>>
  readonly setProjectDisplayName: (
    scope: ExtensionInvokeScope,
    projectPath: string,
    value: string | null,
  ) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateSettingResult>>
  readonly update: (
    scope: ExtensionInvokeScope,
    settings: ExtensionSettingsUpdatePayload,
  ) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateResult>>
}

export interface ExtensionOpenWaggleSdk {
  readonly state: ExtensionOpenWaggleStateSdk
  readonly actions: {
    readonly selectProject: (
      scope: ExtensionInvokeScope,
      projectPath: string,
    ) => Promise<ExtensionInvokeResult<ExtensionActionSelectProjectResult>>
    readonly openExternal: (url: string) => Promise<void>
  }
  readonly settings: ExtensionOpenWaggleSettingsSdk
  readonly docs: {
    readonly discover: (
      scope: ExtensionInvokeScope,
      input?: ExtensionDocsDiscoverPayload,
    ) => Promise<ExtensionInvokeResult<ExtensionDocsDiscoverResult>>
    readonly resolveTopic: (
      scope: ExtensionInvokeScope,
      input: ExtensionDocsResolveTopicPayload,
    ) => Promise<ExtensionInvokeResult<ExtensionDocsResolveTopicResult>>
  }
}

export interface ExtensionRuntimeContributionSdk {
  readonly registerContribution: (
    scope: ExtensionInvokeScope,
    registration: ExtensionRuntimeRegisterContributionPayload,
  ) => Promise<ExtensionInvokeResult<ExtensionRuntimeRegisterContributionResult>>
  readonly unregisterContribution: (
    scope: ExtensionInvokeScope,
    unregistration: ExtensionRuntimeUnregisterContributionPayload,
  ) => Promise<ExtensionInvokeResult<ExtensionRuntimeUnregisterContributionResult>>
}

export interface ExtensionBrokerSdk {
  readonly invoke: ExtensionSdkInvoke
  readonly hostContext: {
    readonly getScope: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult>
  }
  readonly storage: ExtensionPackageStorageSdk
  readonly openWaggle: ExtensionOpenWaggleSdk
  readonly runtime: ExtensionRuntimeContributionSdk
}

export interface CreateOpenWaggleSdkOptions {
  readonly openExternal?: (url: string) => Promise<void>
}
