---
title: "@openwaggle/extension-sdk API"
description: "Complete public API reference for @openwaggle/extension-sdk 0.3."
order: 90
section: "Packages"
kind: "reference"
---

<!-- Generated from the public declarations of @openwaggle/extension-sdk 0.3.0; content sha256 c65c20041dd5a5cdb5738230845e8b5fb40554e3d12b4088ae1b29e834953f97. -->

This reference inventories every public entry point and named export in `@openwaggle/extension-sdk` 0.3.

Browser-safe extension schemas, manifest contracts, broker helpers, runtime types, themes, and framework-neutral UI helpers.

## `@openwaggle/extension-sdk`

Convenience entry point that re-exports the complete browser-safe extension author contract.

| Export | Kind |
|--------|------|
| `createNoopExtensionSurfaceSdk` | function |
| `createOpenWaggleExtensionSharedModules` | function |
| `createOpenWaggleExtensionSurfaceContext` | function |
| `CreateOpenWaggleExtensionSurfaceContextInput` | interface |
| `createOpenWaggleExtensionTheme` | function |
| `CreateOpenWaggleExtensionThemeOptions` | interface |
| `createOpenWaggleExtensionUiStylesheet` | function |
| `CreateOpenWaggleExtensionUiStylesheetOptions` | interface |
| `CreateOpenWaggleSdkOptions` | interface |
| `createPlainExtensionSyntaxResult` | function |
| `defineExtensionManifest` | function |
| `ExtensionActionSelectProjectResult` | type |
| `ExtensionBranchView` | type |
| `ExtensionBrokerCapability` | type |
| `ExtensionBrokerMethod` | type |
| `ExtensionBrokerSdk` | interface |
| `ExtensionBrokerTransport` | type |
| `ExtensionCapabilityAuditEntry` | type |
| `ExtensionCapabilityDeclaration` | type |
| `ExtensionCapabilityScope` | type |
| `ExtensionCommandContribution` | type |
| `ExtensionContributionFamily` | type |
| `ExtensionContributionMatchView` | type |
| `ExtensionContributionRegistration` | type |
| `ExtensionContributionRegistryEntry` | interface |
| `ExtensionContributionRuntime` | type |
| `ExtensionContributions` | type |
| `ExtensionContributionTargetView` | type |
| `ExtensionContributionUnregistration` | type |
| `ExtensionDocsDiscoverOperationResult` | type |
| `ExtensionDocsDiscoverPayload` | type |
| `ExtensionDocsDiscoverResult` | type |
| `ExtensionDocsDiscoveryView` | type |
| `ExtensionDocsResolveTopicOperationResult` | type |
| `ExtensionDocsResolveTopicPayload` | type |
| `ExtensionDocsResolveTopicResult` | type |
| `ExtensionDocsTopicDeclaration` | type |
| `ExtensionEntryContribution` | type |
| `ExtensionExecutionPlacement` | type |
| `ExtensionHostContextResult` | type |
| `ExtensionInstallSource` | type |
| `ExtensionInvokeError` | type |
| `ExtensionInvokeFailure` | type |
| `ExtensionInvokeFailureCode` | type |
| `ExtensionInvokeInput` | type |
| `ExtensionInvokeOutcome` | type |
| `ExtensionInvokeResult` | type |
| `ExtensionInvokeScope` | type |
| `ExtensionInvokeSuccess` | interface |
| `ExtensionInvokeSuccessValue` | type |
| `ExtensionModelPreferencesSettingsPatch` | type |
| `ExtensionModelPrefs` | type |
| `ExtensionNetworkAccessMode` | type |
| `ExtensionOpenWaggleResourcesSdk` | interface |
| `ExtensionOpenWaggleSdk` | interface |
| `ExtensionOpenWaggleSessionResourcesSdk` | type |
| `ExtensionOpenWaggleSettingsSdk` | interface |
| `ExtensionOpenWaggleStateSdk` | interface |
| `ExtensionOperationSuccess` | type |
| `ExtensionPackageScopeKind` | type |
| `ExtensionPackageScopeView` | interface |
| `ExtensionPackageStorageKindSdk` | interface |
| `ExtensionPackageStorageSdk` | interface |
| `ExtensionProjectView` | type |
| `ExtensionRuntimeContributionSdk` | interface |
| `ExtensionRuntimeRegisterContributionOperationResult` | type |
| `ExtensionRuntimeRegisterContributionPayload` | type |
| `ExtensionRuntimeRegisterContributionResult` | type |
| `ExtensionRuntimeRequirementDeclaration` | type |
| `ExtensionRuntimeUnregisterContributionOperationResult` | type |
| `ExtensionRuntimeUnregisterContributionPayload` | type |
| `ExtensionRuntimeUnregisterContributionResult` | type |
| `ExtensionSdkIdentity` | interface |
| `ExtensionSdkInvoke` | type |
| `ExtensionSdkInvokeRequest` | interface |
| `ExtensionSelectedStateReadResult` | interface |
| `ExtensionSelectProjectOperationResult` | type |
| `ExtensionSessionInvokeScope` | type |
| `ExtensionSessionResourceKind` | type |
| `ExtensionSessionResourcePublishOperationResult` | type |
| `ExtensionSessionResourcePublishPayload` | type |
| `ExtensionSessionResourcePublishResult` | type |
| `ExtensionSessionResourceRole` | type |
| `ExtensionSessionResourcesListOperationResult` | type |
| `ExtensionSessionResourcesListPayload` | type |
| `ExtensionSessionResourcesListResult` | type |
| `ExtensionSessionResourceView` | type |
| `ExtensionSessionSummaryContribution` | type |
| `ExtensionSessionSummaryDisclosure` | type |
| `ExtensionSessionSummaryRow` | type |
| `ExtensionSessionSummaryState` | type |
| `ExtensionSessionView` | type |
| `ExtensionSettingsGetOperationResult` | type |
| `ExtensionSettingsGetResult` | type |
| `ExtensionSettingsGetSettingOperationResult` | type |
| `ExtensionSettingsGetSettingResult` | type |
| `ExtensionSettingsKey` | type |
| `ExtensionSettingsSelectedValue` | type |
| `ExtensionSettingsUpdateOperationResult` | type |
| `ExtensionSettingsUpdatePayload` | type |
| `ExtensionSettingsUpdateResult` | type |
| `ExtensionSettingsUpdateSettingOperationResult` | type |
| `ExtensionSettingsUpdateSettingResult` | type |
| `ExtensionSettingsView` | type |
| `ExtensionSidePanelContribution` | type |
| `ExtensionSidePanelIcon` | type |
| `ExtensionStateCurrentBranchReadOperationResult` | type |
| `ExtensionStateCurrentBranchReadResult` | type |
| `ExtensionStateCurrentProjectReadOperationResult` | type |
| `ExtensionStateCurrentProjectReadResult` | type |
| `ExtensionStateCurrentSessionReadOperationResult` | type |
| `ExtensionStateCurrentSessionReadResult` | type |
| `ExtensionStateModelPreferencesReadOperationResult` | type |
| `ExtensionStateModelPreferencesReadResult` | type |
| `ExtensionStateReadOperationResult` | type |
| `ExtensionStateReadResult` | type |
| `ExtensionStateRecentProjectsReadOperationResult` | type |
| `ExtensionStateRecentProjectsReadResult` | type |
| `ExtensionStateSelector` | type |
| `ExtensionStorageDeleteOperationResult` | type |
| `ExtensionStorageDeleteResult` | type |
| `ExtensionStorageGetOperationResult` | type |
| `ExtensionStorageGetResult` | type |
| `ExtensionStorageKind` | type |
| `ExtensionStorageListOperationResult` | type |
| `ExtensionStorageListResult` | type |
| `ExtensionStorageResultBase` | type |
| `ExtensionStorageScope` | type |
| `ExtensionStorageScopeSdk` | interface |
| `ExtensionStorageScopeSelector` | type |
| `ExtensionStorageSetOperationResult` | type |
| `ExtensionStorageSetResult` | type |
| `ExtensionSurfaceContribution` | type |
| `extensionThemeCssVariableDeclarations` | function |
| `extensionThemeCssVariableEntries` | function |
| `ExtensionThemeCssVariableResolver` | type |
| `ExtensionValidationIssue` | interface |
| `ExtensionValidationResult` | type |
| `FirstPartyDocsTopicSummary` | type |
| `JsonArray` | type |
| `JsonObject` | interface |
| `JsonPrimitive` | type |
| `JsonValue` | type |
| `OPENWAGGLE_EXTENSION` | const |
| `OPENWAGGLE_EXTENSION_BROKER` | const |
| `OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES` | const |
| `OPENWAGGLE_EXTENSION_UI_ATTRIBUTES` | const |
| `OPENWAGGLE_EXTENSION_UI_CLASS_NAMES` | const |
| `OpenWaggleAgentLoopSurfaceInput` | type |
| `OpenWaggleCustomMessageSurfaceInput` | type |
| `openWaggleExtensionClassName` | function |
| `OpenWaggleExtensionClassNamePart` | type |
| `OpenWaggleExtensionColorScheme` | type |
| `OpenWaggleExtensionManifest` | type |
| `OpenWaggleExtensionManifestFile` | type |
| `OpenWaggleExtensionMountCleanup` | type |
| `OpenWaggleExtensionMountContext` | interface |
| `OpenWaggleExtensionMountResult` | type |
| `OpenWaggleExtensionSdk` | type |
| `OpenWaggleExtensionSharedModules` | interface |
| `OpenWaggleExtensionSurfaceContext` | interface |
| `OpenWaggleExtensionSurfaceSdk` | interface |
| `OpenWaggleExtensionSyntaxHighlightInput` | interface |
| `OpenWaggleExtensionSyntaxHighlightOptions` | interface |
| `OpenWaggleExtensionSyntaxHighlightResult` | interface |
| `OpenWaggleExtensionSyntaxPriority` | type |
| `OpenWaggleExtensionSyntaxSdk` | interface |
| `OpenWaggleExtensionSyntaxToken` | interface |
| `OpenWaggleExtensionTheme` | interface |
| `OpenWaggleExtensionThemeCssVariableEntry` | interface |
| `OpenWaggleExtensionThemeCssVariables` | type |
| `OpenWaggleExtensionThemeTokens` | interface |
| `OpenWaggleExtensionTypeScaleEntry` | interface |
| `OpenWaggleExtensionUiButtonVariant` | type |
| `OpenWaggleExtensionUiTone` | type |
| `OpenWaggleFederatedModule` | interface |
| `OpenWaggleInteractionSurfaceInput` | type |
| `OpenWaggleStatusSurfaceInput` | type |
| `OpenWaggleToolCallSurfaceInput` | type |
| `OpenWaggleTranscriptSurfaceInput` | type |

## `@openwaggle/extension-sdk/agent-loop`

Typed DTOs and schemas for tool, interaction, transcript, custom-message, and run-status surfaces.

| Export | Kind |
|--------|------|
| `OpenWaggleAgentLoopSurfaceInput` | type |
| `OpenWaggleCustomMessageSurfaceInput` | type |
| `OpenWaggleInteractionSurfaceInput` | type |
| `OpenWaggleStatusSurfaceInput` | type |
| `OpenWaggleToolCallSurfaceInput` | type |
| `OpenWaggleTranscriptSurfaceInput` | type |

## `@openwaggle/extension-sdk/constants`

Stable extension and broker protocol constants.

| Export | Kind |
|--------|------|
| `OPENWAGGLE_EXTENSION` | const |
| `OPENWAGGLE_EXTENSION_BROKER` | const |

## `@openwaggle/extension-sdk/context`

Federated-module mount context, surface SDK, and shared-module helpers.

| Export | Kind |
|--------|------|
| `createNoopExtensionSurfaceSdk` | function |
| `createOpenWaggleExtensionSharedModules` | function |
| `createOpenWaggleExtensionSurfaceContext` | function |
| `CreateOpenWaggleExtensionSurfaceContextInput` | interface |
| `OpenWaggleExtensionMountCleanup` | type |
| `OpenWaggleExtensionMountContext` | interface |
| `OpenWaggleExtensionMountResult` | type |
| `OpenWaggleExtensionSdk` | type |
| `OpenWaggleExtensionSharedModules` | interface |
| `OpenWaggleExtensionSurfaceContext` | interface |
| `OpenWaggleExtensionSurfaceSdk` | interface |
| `OpenWaggleFederatedModule` | interface |

## `@openwaggle/extension-sdk/docs`

Installed documentation discovery and topic contracts.

| Export | Kind |
|--------|------|
| `ExtensionDocsDiscoverPayload` | type |
| `ExtensionDocsDiscoverResult` | type |
| `ExtensionDocsDiscoveryView` | type |
| `ExtensionDocsResolveTopicPayload` | type |
| `ExtensionDocsResolveTopicResult` | type |
| `FirstPartyDocsTopicSummary` | type |

## `@openwaggle/extension-sdk/json`

JSON-safe value types and runtime schemas.

| Export | Kind |
|--------|------|
| `JsonArray` | type |
| `JsonObject` | interface |
| `JsonPrimitive` | type |
| `JsonValue` | type |

## `@openwaggle/extension-sdk/runtime`

Runtime contribution registration contracts and SDK helpers.

| Export | Kind |
|--------|------|
| `ExtensionContributionRegistration` | type |
| `ExtensionContributionUnregistration` | type |
| `ExtensionRuntimeRegisterContributionResult` | type |
| `ExtensionRuntimeUnregisterContributionResult` | type |

## `@openwaggle/extension-sdk/syntax`

Public API for the `./syntax` package export.

| Export | Kind |
|--------|------|
| `createPlainExtensionSyntaxResult` | function |
| `OpenWaggleExtensionSyntaxHighlightInput` | interface |
| `OpenWaggleExtensionSyntaxHighlightOptions` | interface |
| `OpenWaggleExtensionSyntaxHighlightResult` | interface |
| `OpenWaggleExtensionSyntaxPriority` | type |
| `OpenWaggleExtensionSyntaxSdk` | interface |
| `OpenWaggleExtensionSyntaxToken` | interface |

## `@openwaggle/extension-sdk/testing`

Public API for the `./testing` package export.

| Export | Kind |
|--------|------|
| `createExtensionBrokerSdk` | function |
| `createExtensionBrokerSdkFromInvoke` | function |
| `CreateOpenWaggleSdkOptions` | interface |
| `createRuntimeContributionSdk` | function |
| `ExtensionBrokerSdk` | interface |
| `ExtensionBrokerTransport` | type |
| `ExtensionSdkIdentity` | interface |
| `ExtensionSdkInvoke` | type |
| `ExtensionSdkInvokeRequest` | interface |
| `toInvokeInput` | const |

## `@openwaggle/extension-sdk/theme`

Host-provided theme tokens and CSS variable helpers.

| Export | Kind |
|--------|------|
| `createOpenWaggleExtensionTheme` | function |
| `CreateOpenWaggleExtensionThemeOptions` | interface |
| `extensionThemeCssVariableEntries` | function |
| `ExtensionThemeCssVariableResolver` | type |
| `OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES` | const |
| `OpenWaggleExtensionColorScheme` | type |
| `OpenWaggleExtensionTheme` | interface |
| `OpenWaggleExtensionThemeCssVariableEntry` | interface |
| `OpenWaggleExtensionThemeCssVariables` | type |
| `OpenWaggleExtensionThemeTokens` | interface |
| `OpenWaggleExtensionTypeScaleEntry` | interface |

## `@openwaggle/extension-sdk/types`

Shared extension package, contribution, and registry contracts.

| Export | Kind |
|--------|------|
| `ExtensionActionSelectProjectResult` | type |
| `ExtensionBranchView` | type |
| `ExtensionBrokerCapability` | type |
| `ExtensionBrokerMethod` | type |
| `ExtensionCapabilityAuditEntry` | type |
| `ExtensionCapabilityScope` | type |
| `ExtensionContributionFamily` | type |
| `ExtensionContributionMatchView` | type |
| `ExtensionContributionRegistryEntry` | interface |
| `ExtensionContributionRuntime` | type |
| `ExtensionContributionTargetView` | type |
| `ExtensionDocsDiscoverPayload` | type |
| `ExtensionDocsDiscoverResult` | type |
| `ExtensionDocsResolveTopicPayload` | type |
| `ExtensionDocsResolveTopicResult` | type |
| `ExtensionExecutionPlacement` | type |
| `ExtensionHostContextResult` | type |
| `ExtensionInstallSource` | type |
| `ExtensionInvokeError` | type |
| `ExtensionInvokeFailure` | type |
| `ExtensionInvokeFailureCode` | type |
| `ExtensionInvokeInput` | type |
| `ExtensionInvokeOutcome` | type |
| `ExtensionInvokeResult` | type |
| `ExtensionInvokeScope` | type |
| `ExtensionInvokeSuccess` | interface |
| `ExtensionInvokeSuccessValue` | type |
| `ExtensionModelPreferencesSettingsPatch` | type |
| `ExtensionModelPrefs` | type |
| `ExtensionNetworkAccessMode` | type |
| `ExtensionPackageScopeKind` | type |
| `ExtensionPackageScopeView` | interface |
| `ExtensionProjectView` | type |
| `ExtensionRuntimeRegisterContributionPayload` | type |
| `ExtensionRuntimeRegisterContributionResult` | type |
| `ExtensionRuntimeUnregisterContributionPayload` | type |
| `ExtensionRuntimeUnregisterContributionResult` | type |
| `ExtensionSelectedStateReadResult` | interface |
| `ExtensionSessionResourceKind` | type |
| `ExtensionSessionResourcePublishPayload` | type |
| `ExtensionSessionResourcePublishResult` | type |
| `ExtensionSessionResourceRole` | type |
| `ExtensionSessionResourcesListPayload` | type |
| `ExtensionSessionResourcesListResult` | type |
| `ExtensionSessionResourceView` | type |
| `ExtensionSessionView` | type |
| `ExtensionSettingsGetResult` | type |
| `ExtensionSettingsGetSettingResult` | type |
| `ExtensionSettingsKey` | type |
| `ExtensionSettingsSelectedValue` | type |
| `ExtensionSettingsUpdatePayload` | type |
| `ExtensionSettingsUpdateResult` | type |
| `ExtensionSettingsUpdateSettingResult` | type |
| `ExtensionSettingsView` | type |
| `ExtensionStateCurrentBranchReadResult` | type |
| `ExtensionStateCurrentProjectReadResult` | type |
| `ExtensionStateCurrentSessionReadResult` | type |
| `ExtensionStateModelPreferencesReadResult` | type |
| `ExtensionStateReadResult` | type |
| `ExtensionStateRecentProjectsReadResult` | type |
| `ExtensionStateSelector` | type |
| `ExtensionStorageDeleteResult` | type |
| `ExtensionStorageGetResult` | type |
| `ExtensionStorageKind` | type |
| `ExtensionStorageListResult` | type |
| `ExtensionStorageResultBase` | type |
| `ExtensionStorageScope` | type |
| `ExtensionStorageScopeSelector` | type |
| `ExtensionStorageSetResult` | type |
| `ExtensionValidationIssue` | interface |
| `ExtensionValidationResult` | type |

## `@openwaggle/extension-sdk/ui`

Framework-neutral class names, attributes, and stylesheet generation.

| Export | Kind |
|--------|------|
| `createOpenWaggleExtensionUiStylesheet` | function |
| `CreateOpenWaggleExtensionUiStylesheetOptions` | interface |
| `extensionThemeCssVariableDeclarations` | function |
| `OPENWAGGLE_EXTENSION_UI_ATTRIBUTES` | const |
| `OPENWAGGLE_EXTENSION_UI_CLASS_NAMES` | const |
| `openWaggleExtensionClassName` | function |
| `OpenWaggleExtensionClassNamePart` | type |
| `OpenWaggleExtensionUiButtonVariant` | type |
| `OpenWaggleExtensionUiTone` | type |

## `@openwaggle/extension-sdk/validation`

Public API for the `./validation` package export.

| Export | Kind |
|--------|------|
| `ExtensionValidationIssue` | interface |
| `ExtensionValidationResult` | type |
| `validateBrokerCapabilityDeclaration` | const |
| `validateExtensionManifest` | const |
| `validateOpenWaggleExtensionTheme` | const |
