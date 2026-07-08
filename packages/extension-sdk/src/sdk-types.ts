import type { JsonValue } from './json.js'
import type {
  ExtensionActionSelectProjectResult,
  ExtensionDocsDiscoverPayload,
  ExtensionDocsDiscoverResult,
  ExtensionDocsResolveTopicPayload,
  ExtensionDocsResolveTopicResult,
  ExtensionInvokeInput,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
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

export type ExtensionBrokerTransport = <TValue = unknown>(
  input: ExtensionInvokeInput,
) => Promise<ExtensionInvokeResult<TValue>>

export type ExtensionSdkInvoke = <TValue = unknown>(
  request: ExtensionSdkInvokeRequest,
) => Promise<ExtensionInvokeResult<TValue>>

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
