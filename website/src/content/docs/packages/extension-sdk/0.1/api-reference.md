---
title: "@openwaggle/extension-sdk API"
description: "Complete public API reference for @openwaggle/extension-sdk 0.1."
order: 90
section: "Packages"
---

<!-- Generated from the checked public package declarations. -->

This reference inventories every public entry point and named export in `@openwaggle/extension-sdk` 0.1.

Browser-safe extension schemas, manifest contracts, broker helpers, runtime types, themes, and framework-neutral UI helpers.

## `@openwaggle/extension-sdk`

Convenience entry point that re-exports the complete browser-safe extension author contract.

| Export | Kind |
|--------|------|
| `createExtensionBrokerSdk` | function |
| `createExtensionBrokerSdkFromInvoke` | function |
| `createNoopExtensionSurfaceSdk` | function |
| `createOpenWaggleExtensionSharedModules` | function |
| `createOpenWaggleExtensionSurfaceContext` | function |
| `CreateOpenWaggleExtensionSurfaceContextInput` | interface |
| `createOpenWaggleExtensionTheme` | function |
| `CreateOpenWaggleExtensionThemeOptions` | interface |
| `createOpenWaggleExtensionUiStylesheet` | function |
| `CreateOpenWaggleExtensionUiStylesheetOptions` | interface |
| `CreateOpenWaggleSdkOptions` | interface |
| `createRuntimeContributionSdk` | function |
| `defineExtensionManifest` | function |
| `docsDiscoveryDiagnosticSchema` | const |
| `docsDiscoveryViewSchema` | const |
| `ExtensionActionSelectProjectResult` | interface |
| `ExtensionBranchView` | interface |
| `ExtensionBrokerCapability` | type |
| `ExtensionBrokerMethod` | type |
| `ExtensionBrokerSdk` | interface |
| `ExtensionBrokerTransport` | type |
| `extensionBuildSchema` | const |
| `ExtensionCapabilityAuditEntry` | interface |
| `extensionCapabilityAuditEntrySchema` | const |
| `ExtensionCapabilityDeclaration` | type |
| `extensionCapabilityDeclarationSchema` | const |
| `ExtensionCapabilityScope` | type |
| `extensionCapabilityScopeSchema` | const |
| `ExtensionCommandContribution` | type |
| `extensionCommandContributionFamilySchema` | const |
| `extensionCommandContributionRegistrationSchema` | const |
| `extensionCommandContributionSchema` | const |
| `ExtensionContributionFamily` | type |
| `extensionContributionFamilySchema` | const |
| `extensionContributionIdSchema` | const |
| `ExtensionContributionMatchView` | interface |
| `ExtensionContributionRegistration` | type |
| `extensionContributionRegistrationSchema` | const |
| `ExtensionContributionRegistryEntry` | interface |
| `ExtensionContributionRuntime` | type |
| `extensionContributionRuntimeSchema` | const |
| `ExtensionContributions` | type |
| `extensionContributionsSchema` | const |
| `ExtensionContributionTargetView` | interface |
| `ExtensionContributionUnregistration` | type |
| `extensionContributionUnregistrationSchema` | const |
| `ExtensionDocsDiscoverOperationResult` | type |
| `ExtensionDocsDiscoverPayload` | type |
| `extensionDocsDiscoverPayloadSchema` | const |
| `ExtensionDocsDiscoverResult` | type |
| `extensionDocsDiscoverResultSchema` | const |
| `ExtensionDocsDiscoveryView` | type |
| `extensionDocsPackageScopeViewSchema` | const |
| `extensionDocsProvenanceSchema` | const |
| `ExtensionDocsResolveTopicOperationResult` | type |
| `ExtensionDocsResolveTopicPayload` | type |
| `extensionDocsResolveTopicPayloadSchema` | const |
| `ExtensionDocsResolveTopicResult` | type |
| `extensionDocsResolveTopicResultSchema` | const |
| `extensionDocsSchema` | const |
| `ExtensionDocsTopicDeclaration` | type |
| `extensionDocsTopicDeclarationSchema` | const |
| `extensionDocsTopicSummarySchema` | const |
| `ExtensionEntryContribution` | type |
| `ExtensionExecutionPlacement` | type |
| `extensionExecutionPlacementSchema` | const |
| `extensionIdSchema` | const |
| `extensionInstallSchema` | const |
| `ExtensionInstallSource` | type |
| `extensionInstallSourceSchema` | const |
| `ExtensionInvokeError` | interface |
| `extensionInvokeErrorSchema` | const |
| `ExtensionInvokeFailure` | interface |
| `ExtensionInvokeFailureCode` | type |
| `extensionInvokeFailureSchema` | const |
| `ExtensionInvokeInput` | interface |
| `extensionInvokeInputSchema` | const |
| `ExtensionInvokeOutcome` | type |
| `ExtensionInvokeResult` | type |
| `extensionInvokeResultSchema` | const |
| `ExtensionInvokeScope` | type |
| `extensionInvokeScopeSchema` | const |
| `ExtensionInvokeSuccess` | interface |
| `extensionInvokeSuccessSchema` | const |
| `ExtensionManifestValidationResult` | type |
| `ExtensionModelPreferencesSettingsPatch` | interface |
| `ExtensionModelPrefs` | interface |
| `ExtensionNetworkAccessMode` | type |
| `extensionNetworkSchema` | const |
| `ExtensionOpenWaggleSdk` | interface |
| `ExtensionOpenWaggleSettingsSdk` | interface |
| `ExtensionOpenWaggleStateSdk` | interface |
| `ExtensionOperationSuccess` | type |
| `ExtensionPackageScopeKind` | type |
| `ExtensionPackageScopeView` | interface |
| `ExtensionPackageStorageKindSdk` | interface |
| `ExtensionPackageStorageSdk` | interface |
| `ExtensionProjectView` | interface |
| `extensionRelativePathSchema` | const |
| `extensionRouteContributionRegistrationSchema` | const |
| `extensionRouteContributionSchema` | const |
| `ExtensionRuntimeContributionSdk` | interface |
| `ExtensionRuntimeRegisterContributionOperationResult` | type |
| `ExtensionRuntimeRegisterContributionPayload` | type |
| `ExtensionRuntimeRegisterContributionResult` | interface |
| `extensionRuntimeRegisterContributionResultSchema` | const |
| `ExtensionRuntimeRequirementDeclaration` | type |
| `extensionRuntimeRequirementSchema` | const |
| `extensionRuntimeRequirementTypeSchema` | const |
| `ExtensionRuntimeUnregisterContributionOperationResult` | type |
| `ExtensionRuntimeUnregisterContributionPayload` | type |
| `ExtensionRuntimeUnregisterContributionResult` | interface |
| `extensionRuntimeUnregisterContributionResultSchema` | const |
| `ExtensionSdkIdentity` | interface |
| `ExtensionSdkInvoke` | type |
| `ExtensionSdkInvokeRequest` | interface |
| `ExtensionSelectedStateReadResult` | interface |
| `ExtensionSelectProjectOperationResult` | type |
| `extensionSemverVersionSchema` | const |
| `ExtensionSessionView` | interface |
| `ExtensionSettingsGetOperationResult` | type |
| `ExtensionSettingsGetResult` | interface |
| `ExtensionSettingsGetSettingOperationResult` | type |
| `ExtensionSettingsGetSettingResult` | interface |
| `ExtensionSettingsKey` | type |
| `ExtensionSettingsSelectedValue` | type |
| `ExtensionSettingsUpdateOperationResult` | type |
| `ExtensionSettingsUpdatePayload` | type |
| `ExtensionSettingsUpdateResult` | interface |
| `ExtensionSettingsUpdateSettingOperationResult` | type |
| `ExtensionSettingsUpdateSettingResult` | interface |
| `ExtensionSettingsView` | interface |
| `extensionSlotContributionFamilySchema` | const |
| `extensionSlotContributionRegistrationSchema` | const |
| `extensionSlotContributionSchema` | const |
| `ExtensionStateCurrentBranchReadOperationResult` | type |
| `ExtensionStateCurrentBranchReadResult` | type |
| `ExtensionStateCurrentProjectReadOperationResult` | type |
| `ExtensionStateCurrentProjectReadResult` | type |
| `ExtensionStateCurrentSessionReadOperationResult` | type |
| `ExtensionStateCurrentSessionReadResult` | type |
| `ExtensionStateModelPreferencesReadOperationResult` | type |
| `ExtensionStateModelPreferencesReadResult` | type |
| `ExtensionStateReadOperationResult` | type |
| `ExtensionStateReadResult` | interface |
| `ExtensionStateRecentProjectsReadOperationResult` | type |
| `ExtensionStateRecentProjectsReadResult` | type |
| `ExtensionStateSelector` | type |
| `ExtensionStorageDeleteOperationResult` | type |
| `ExtensionStorageDeleteResult` | interface |
| `ExtensionStorageGetOperationResult` | type |
| `ExtensionStorageGetResult` | interface |
| `ExtensionStorageKind` | type |
| `ExtensionStorageListOperationResult` | type |
| `ExtensionStorageListResult` | interface |
| `ExtensionStorageResultBase` | interface |
| `ExtensionStorageScope` | type |
| `ExtensionStorageScopeSdk` | interface |
| `ExtensionStorageScopeSelector` | type |
| `ExtensionStorageSetOperationResult` | type |
| `ExtensionStorageSetResult` | interface |
| `extensionThemeCssVariableDeclarations` | function |
| `extensionThemeCssVariableEntries` | function |
| `ExtensionThemeCssVariableResolver` | type |
| `FirstPartyDocsTopicSummary` | type |
| `firstPartyDocsTopicSummarySchema` | const |
| `firstPartyDocTopicSchema` | const |
| `isOpenWaggleExtensionTheme` | function |
| `JsonArray` | type |
| `JsonObject` | interface |
| `JsonPrimitive` | type |
| `jsonPrimitiveSchema` | const |
| `JsonValue` | type |
| `jsonValueSchema` | const |
| `OPENWAGGLE_EXTENSION` | const |
| `OPENWAGGLE_EXTENSION_BROKER` | const |
| `OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES` | const |
| `OPENWAGGLE_EXTENSION_UI_ATTRIBUTES` | const |
| `OPENWAGGLE_EXTENSION_UI_CLASS_NAMES` | const |
| `OpenWaggleAgentLoopSurfaceInput` | type |
| `openWaggleAgentLoopSurfaceInputSchema` | const |
| `OpenWaggleCustomMessageSurfaceInput` | interface |
| `openWaggleCustomMessageSurfaceInputSchema` | const |
| `openWaggleExtensionClassName` | function |
| `OpenWaggleExtensionClassNamePart` | type |
| `OpenWaggleExtensionColorScheme` | type |
| `OpenWaggleExtensionManifest` | type |
| `OpenWaggleExtensionManifestFile` | type |
| `openWaggleExtensionManifestSchema` | const |
| `OpenWaggleExtensionMountCleanup` | type |
| `OpenWaggleExtensionMountContext` | interface |
| `OpenWaggleExtensionMountResult` | type |
| `OpenWaggleExtensionSdk` | type |
| `OpenWaggleExtensionSharedModules` | interface |
| `OpenWaggleExtensionSurfaceContext` | interface |
| `OpenWaggleExtensionSurfaceSdk` | interface |
| `OpenWaggleExtensionTheme` | interface |
| `OpenWaggleExtensionThemeCssVariableEntry` | interface |
| `OpenWaggleExtensionThemeCssVariables` | type |
| `OpenWaggleExtensionThemeTokens` | interface |
| `OpenWaggleExtensionUiButtonVariant` | type |
| `OpenWaggleExtensionUiTone` | type |
| `OpenWaggleFederatedModule` | interface |
| `OpenWaggleInteractionSurfaceInput` | interface |
| `openWaggleInteractionSurfaceInputSchema` | const |
| `OpenWaggleStatusSurfaceInput` | interface |
| `openWaggleStatusSurfaceInputSchema` | const |
| `OpenWaggleToolCallSurfaceInput` | interface |
| `openWaggleToolCallSurfaceInputSchema` | const |
| `OpenWaggleTranscriptSurfaceInput` | interface |
| `openWaggleTranscriptSurfaceInputSchema` | const |
| `toInvokeInput` | function |
| `validateExtensionManifest` | function |

## `@openwaggle/extension-sdk/agent-loop`

Typed DTOs and schemas for tool, interaction, transcript, custom-message, and run-status surfaces.

| Export | Kind |
|--------|------|
| `OpenWaggleAgentLoopSurfaceInput` | type |
| `openWaggleAgentLoopSurfaceInputSchema` | const |
| `OpenWaggleCustomMessageSurfaceInput` | interface |
| `openWaggleCustomMessageSurfaceInputSchema` | const |
| `OpenWaggleInteractionSurfaceInput` | interface |
| `openWaggleInteractionSurfaceInputSchema` | const |
| `OpenWaggleStatusSurfaceInput` | interface |
| `openWaggleStatusSurfaceInputSchema` | const |
| `OpenWaggleToolCallSurfaceInput` | interface |
| `openWaggleToolCallSurfaceInputSchema` | const |
| `OpenWaggleTranscriptSurfaceInput` | interface |
| `openWaggleTranscriptSurfaceInputSchema` | const |

## `@openwaggle/extension-sdk/broker`

Capability-broker request, response, scope, audit, and SDK helpers.

| Export | Kind |
|--------|------|
| `createExtensionBrokerSdk` | function |
| `createExtensionBrokerSdkFromInvoke` | function |
| `CreateOpenWaggleSdkOptions` | interface |
| `ExtensionBrokerCapability` | type |
| `ExtensionBrokerMethod` | type |
| `ExtensionBrokerSdk` | interface |
| `ExtensionBrokerTransport` | type |
| `ExtensionCapabilityAuditEntry` | interface |
| `extensionCapabilityAuditEntrySchema` | const |
| `ExtensionDocsDiscoverOperationResult` | type |
| `ExtensionDocsResolveTopicOperationResult` | type |
| `ExtensionInvokeError` | interface |
| `extensionInvokeErrorSchema` | const |
| `ExtensionInvokeFailure` | interface |
| `ExtensionInvokeFailureCode` | type |
| `extensionInvokeFailureSchema` | const |
| `ExtensionInvokeInput` | interface |
| `extensionInvokeInputSchema` | const |
| `ExtensionInvokeOutcome` | type |
| `ExtensionInvokeResult` | type |
| `extensionInvokeResultSchema` | const |
| `ExtensionInvokeScope` | type |
| `extensionInvokeScopeSchema` | const |
| `ExtensionInvokeSuccess` | interface |
| `extensionInvokeSuccessSchema` | const |
| `ExtensionOpenWaggleSdk` | interface |
| `ExtensionOpenWaggleSettingsSdk` | interface |
| `ExtensionOpenWaggleStateSdk` | interface |
| `ExtensionOperationSuccess` | type |
| `ExtensionPackageStorageKindSdk` | interface |
| `ExtensionPackageStorageSdk` | interface |
| `ExtensionRuntimeContributionSdk` | interface |
| `ExtensionRuntimeRegisterContributionOperationResult` | type |
| `ExtensionRuntimeUnregisterContributionOperationResult` | type |
| `ExtensionSdkIdentity` | interface |
| `ExtensionSdkInvoke` | type |
| `ExtensionSdkInvokeRequest` | interface |
| `ExtensionSelectProjectOperationResult` | type |
| `ExtensionSettingsGetOperationResult` | type |
| `ExtensionSettingsGetSettingOperationResult` | type |
| `ExtensionSettingsKey` | type |
| `ExtensionSettingsUpdateOperationResult` | type |
| `ExtensionSettingsUpdateSettingOperationResult` | type |
| `ExtensionStateCurrentBranchReadOperationResult` | type |
| `ExtensionStateCurrentProjectReadOperationResult` | type |
| `ExtensionStateCurrentSessionReadOperationResult` | type |
| `ExtensionStateModelPreferencesReadOperationResult` | type |
| `ExtensionStateReadOperationResult` | type |
| `ExtensionStateRecentProjectsReadOperationResult` | type |
| `ExtensionStateSelector` | type |
| `ExtensionStorageDeleteOperationResult` | type |
| `ExtensionStorageGetOperationResult` | type |
| `ExtensionStorageListOperationResult` | type |
| `ExtensionStorageScopeSdk` | interface |
| `ExtensionStorageSetOperationResult` | type |
| `toInvokeInput` | function |

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
| `docsDiscoveryDiagnosticSchema` | const |
| `docsDiscoveryViewSchema` | const |
| `ExtensionDocsDiscoverPayload` | type |
| `extensionDocsDiscoverPayloadSchema` | const |
| `ExtensionDocsDiscoverResult` | type |
| `extensionDocsDiscoverResultSchema` | const |
| `ExtensionDocsDiscoveryView` | type |
| `extensionDocsPackageScopeViewSchema` | const |
| `extensionDocsProvenanceSchema` | const |
| `ExtensionDocsResolveTopicPayload` | type |
| `extensionDocsResolveTopicPayloadSchema` | const |
| `ExtensionDocsResolveTopicResult` | type |
| `extensionDocsResolveTopicResultSchema` | const |
| `extensionDocsTopicSummarySchema` | const |
| `FirstPartyDocsTopicSummary` | type |
| `firstPartyDocsTopicSummarySchema` | const |
| `firstPartyDocTopicSchema` | const |

## `@openwaggle/extension-sdk/json`

JSON-safe value types and runtime schemas.

| Export | Kind |
|--------|------|
| `JsonArray` | type |
| `JsonObject` | interface |
| `JsonPrimitive` | type |
| `jsonPrimitiveSchema` | const |
| `JsonValue` | type |
| `jsonValueSchema` | const |

## `@openwaggle/extension-sdk/manifest`

Extension manifest schemas, contribution declarations, and validation helpers.

| Export | Kind |
|--------|------|
| `defineExtensionManifest` | function |
| `extensionBuildSchema` | const |
| `ExtensionCapabilityDeclaration` | type |
| `extensionCapabilityDeclarationSchema` | const |
| `extensionCapabilityScopeSchema` | const |
| `ExtensionCommandContribution` | type |
| `extensionCommandContributionFamilySchema` | const |
| `extensionCommandContributionRegistrationSchema` | const |
| `extensionCommandContributionSchema` | const |
| `extensionContributionFamilySchema` | const |
| `extensionContributionIdSchema` | const |
| `ExtensionContributionRegistration` | type |
| `extensionContributionRegistrationSchema` | const |
| `extensionContributionRuntimeSchema` | const |
| `ExtensionContributions` | type |
| `extensionContributionsSchema` | const |
| `ExtensionContributionUnregistration` | type |
| `extensionContributionUnregistrationSchema` | const |
| `extensionDocsSchema` | const |
| `ExtensionDocsTopicDeclaration` | type |
| `extensionDocsTopicDeclarationSchema` | const |
| `ExtensionEntryContribution` | type |
| `extensionExecutionPlacementSchema` | const |
| `extensionIdSchema` | const |
| `extensionInstallSchema` | const |
| `extensionInstallSourceSchema` | const |
| `ExtensionManifestValidationResult` | type |
| `extensionNetworkSchema` | const |
| `extensionRelativePathSchema` | const |
| `extensionRouteContributionRegistrationSchema` | const |
| `extensionRouteContributionSchema` | const |
| `ExtensionRuntimeRequirementDeclaration` | type |
| `extensionRuntimeRequirementSchema` | const |
| `extensionRuntimeRequirementTypeSchema` | const |
| `extensionSemverVersionSchema` | const |
| `extensionSlotContributionFamilySchema` | const |
| `extensionSlotContributionRegistrationSchema` | const |
| `extensionSlotContributionSchema` | const |
| `OpenWaggleExtensionManifest` | type |
| `OpenWaggleExtensionManifestFile` | type |
| `openWaggleExtensionManifestSchema` | const |
| `validateExtensionManifest` | function |

## `@openwaggle/extension-sdk/runtime`

Runtime contribution registration contracts and SDK helpers.

| Export | Kind |
|--------|------|
| `createRuntimeContributionSdk` | function |
| `ExtensionContributionRegistration` | type |
| `extensionContributionRegistrationSchema` | const |
| `ExtensionContributionUnregistration` | type |
| `extensionContributionUnregistrationSchema` | const |
| `ExtensionRuntimeRegisterContributionResult` | interface |
| `extensionRuntimeRegisterContributionResultSchema` | const |
| `ExtensionRuntimeUnregisterContributionResult` | interface |
| `extensionRuntimeUnregisterContributionResultSchema` | const |

## `@openwaggle/extension-sdk/theme`

Host-provided theme tokens and CSS variable helpers.

| Export | Kind |
|--------|------|
| `createOpenWaggleExtensionTheme` | function |
| `CreateOpenWaggleExtensionThemeOptions` | interface |
| `extensionThemeCssVariableEntries` | function |
| `ExtensionThemeCssVariableResolver` | type |
| `isOpenWaggleExtensionTheme` | function |
| `OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES` | const |
| `OpenWaggleExtensionColorScheme` | type |
| `OpenWaggleExtensionTheme` | interface |
| `OpenWaggleExtensionThemeCssVariableEntry` | interface |
| `OpenWaggleExtensionThemeCssVariables` | type |
| `OpenWaggleExtensionThemeTokens` | interface |

## `@openwaggle/extension-sdk/types`

Shared extension package, contribution, and registry contracts.

| Export | Kind |
|--------|------|
| `ExtensionActionSelectProjectResult` | interface |
| `ExtensionBranchView` | interface |
| `ExtensionBrokerCapability` | type |
| `ExtensionBrokerMethod` | type |
| `ExtensionCapabilityAuditEntry` | interface |
| `ExtensionCapabilityScope` | type |
| `ExtensionContributionFamily` | type |
| `ExtensionContributionMatchView` | interface |
| `ExtensionContributionRegistryEntry` | interface |
| `ExtensionContributionRuntime` | type |
| `ExtensionContributionTargetView` | interface |
| `ExtensionDocsDiscoverPayload` | type |
| `ExtensionDocsDiscoverResult` | type |
| `ExtensionDocsResolveTopicPayload` | type |
| `ExtensionDocsResolveTopicResult` | type |
| `ExtensionExecutionPlacement` | type |
| `ExtensionInstallSource` | type |
| `ExtensionInvokeError` | interface |
| `ExtensionInvokeFailure` | interface |
| `ExtensionInvokeFailureCode` | type |
| `ExtensionInvokeInput` | interface |
| `ExtensionInvokeOutcome` | type |
| `ExtensionInvokeResult` | type |
| `ExtensionInvokeScope` | type |
| `ExtensionInvokeSuccess` | interface |
| `ExtensionModelPreferencesSettingsPatch` | interface |
| `ExtensionModelPrefs` | interface |
| `ExtensionNetworkAccessMode` | type |
| `ExtensionPackageScopeKind` | type |
| `ExtensionPackageScopeView` | interface |
| `ExtensionProjectView` | interface |
| `ExtensionRuntimeRegisterContributionPayload` | type |
| `ExtensionRuntimeRegisterContributionResult` | interface |
| `ExtensionRuntimeUnregisterContributionPayload` | type |
| `ExtensionRuntimeUnregisterContributionResult` | interface |
| `ExtensionSelectedStateReadResult` | interface |
| `ExtensionSessionView` | interface |
| `ExtensionSettingsGetResult` | interface |
| `ExtensionSettingsGetSettingResult` | interface |
| `ExtensionSettingsKey` | type |
| `ExtensionSettingsSelectedValue` | type |
| `ExtensionSettingsUpdatePayload` | type |
| `ExtensionSettingsUpdateResult` | interface |
| `ExtensionSettingsUpdateSettingResult` | interface |
| `ExtensionSettingsView` | interface |
| `ExtensionStateCurrentBranchReadResult` | type |
| `ExtensionStateCurrentProjectReadResult` | type |
| `ExtensionStateCurrentSessionReadResult` | type |
| `ExtensionStateModelPreferencesReadResult` | type |
| `ExtensionStateReadResult` | interface |
| `ExtensionStateRecentProjectsReadResult` | type |
| `ExtensionStateSelector` | type |
| `ExtensionStorageDeleteResult` | interface |
| `ExtensionStorageGetResult` | interface |
| `ExtensionStorageKind` | type |
| `ExtensionStorageListResult` | interface |
| `ExtensionStorageResultBase` | interface |
| `ExtensionStorageScope` | type |
| `ExtensionStorageScopeSelector` | type |
| `ExtensionStorageSetResult` | interface |

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
