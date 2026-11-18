// Generated from src/internal/type-sources/broker-result.ts by scripts/generate-extension-sdk-types.ts;
// do not edit. Regenerate with `bun run extension-sdk-types:generate`; the
// `extension-sdk-types` check step fails when this file no longer matches the schemas.

import type { ExtensionHostContextResult } from './broker.js'
import type { ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicResult } from './docs.js'
import type {
  ExtensionActionSelectProjectResult,
  ExtensionSessionResourcePublishResult,
  ExtensionSessionResourcesListResult,
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
} from './openwaggle.js'
import type {
  ExtensionRuntimeRegisterContributionResult,
  ExtensionRuntimeUnregisterContributionResult,
  ExtensionStorageDeleteResult,
  ExtensionStorageGetResult,
  ExtensionStorageListResult,
  ExtensionStorageSetResult,
} from './storage.js'

/** Every result value the broker returns, one per capability method. */
export type ExtensionInvokeSuccessValue =
  | ExtensionActionSelectProjectResult
  | ExtensionDocsDiscoverResult
  | ExtensionDocsResolveTopicResult
  | ExtensionHostContextResult
  | ExtensionRuntimeRegisterContributionResult
  | ExtensionRuntimeUnregisterContributionResult
  | ExtensionSessionResourcePublishResult
  | ExtensionSessionResourcesListResult
  | ExtensionSettingsGetResult
  | ExtensionSettingsGetSettingResult
  | ExtensionSettingsUpdateResult
  | ExtensionSettingsUpdateSettingResult
  | ExtensionStateCurrentBranchReadResult
  | ExtensionStateCurrentProjectReadResult
  | ExtensionStateCurrentSessionReadResult
  | ExtensionStateModelPreferencesReadResult
  | ExtensionStateReadResult
  | ExtensionStateRecentProjectsReadResult
  | ExtensionStorageDeleteResult
  | ExtensionStorageGetResult
  | ExtensionStorageListResult
  | ExtensionStorageSetResult
