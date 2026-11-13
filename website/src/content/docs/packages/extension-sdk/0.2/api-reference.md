---
title: "@openwaggle/extension-sdk API"
description: "Complete public API reference for @openwaggle/extension-sdk 0.2."
order: 90
section: "Packages"
kind: "reference"
---

<!-- Generated from the checked public package declarations. -->

This reference inventories every public entry point and named export in `@openwaggle/extension-sdk` 0.2.

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
| `createPlainExtensionSyntaxResult` | function |
| `createRuntimeContributionSdk` | function |
| `defineExtensionManifest` | function |
| `docsDiscoveryDiagnosticSchema` | const |
| `docsDiscoveryViewSchema` | const |
| `extensionActionSelectProjectPayloadSchema` | const |
| `ExtensionActionSelectProjectResult` | type |
| `extensionActionSelectProjectResultSchema` | const |
| `ExtensionBranchView` | type |
| `extensionBranchViewSchema` | const |
| `ExtensionBrokerCapability` | type |
| `ExtensionBrokerMethod` | type |
| `extensionBrokerMethodSchema` | const |
| `ExtensionBrokerSdk` | interface |
| `ExtensionBrokerTransport` | type |
| `extensionBuildSchema` | const |
| `ExtensionCapabilityAuditEntry` | type |
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
| `extensionHostContextResultSchema` | const |
| `extensionIdSchema` | const |
| `extensionInstallSchema` | const |
| `ExtensionInstallSource` | type |
| `extensionInstallSourceSchema` | const |
| `extensionInvocationBindingSchema` | const |
| `extensionInvokeAppScopeSchema` | const |
| `extensionInvokeBranchScopeSchema` | const |
| `extensionInvokeDeclaredResultSchema` | const |
| `extensionInvokeDeclaredSuccessSchema` | const |
| `ExtensionInvokeError` | type |
| `extensionInvokeErrorSchema` | const |
| `ExtensionInvokeFailure` | type |
| `ExtensionInvokeFailureCode` | type |
| `extensionInvokeFailureCodeSchema` | const |
| `extensionInvokeFailureSchema` | const |
| `ExtensionInvokeInput` | type |
| `extensionInvokeInputSchema` | const |
| `ExtensionInvokeOutcome` | type |
| `extensionInvokeOutcomeSchema` | const |
| `extensionInvokeProjectScopeSchema` | const |
| `ExtensionInvokeResult` | type |
| `extensionInvokeResultSchema` | const |
| `ExtensionInvokeScope` | type |
| `extensionInvokeScopeSchema` | const |
| `extensionInvokeSessionScopeSchema` | const |
| `ExtensionInvokeSuccess` | type |
| `extensionInvokeSuccessSchema` | const |
| `ExtensionInvokeSuccessValue` | type |
| `extensionInvokeSuccessValueSchema` | const |
| `ExtensionManifestValidationResult` | type |
| `ExtensionModelPreferencesSettingsPatch` | type |
| `extensionModelPreferencesSettingsPatchSchema` | const |
| `ExtensionModelPrefs` | type |
| `extensionModelPrefsSchema` | const |
| `ExtensionNetworkAccessMode` | type |
| `extensionNetworkSchema` | const |
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
| `extensionProjectViewSchema` | const |
| `extensionRelativePathSchema` | const |
| `extensionRouteContributionRegistrationSchema` | const |
| `extensionRouteContributionSchema` | const |
| `ExtensionRuntimeContributionSdk` | interface |
| `ExtensionRuntimeRegisterContributionOperationResult` | type |
| `ExtensionRuntimeRegisterContributionPayload` | type |
| `extensionRuntimeRegisterContributionPayloadSchema` | const |
| `ExtensionRuntimeRegisterContributionResult` | type |
| `extensionRuntimeRegisterContributionResultSchema` | const |
| `ExtensionRuntimeRequirementDeclaration` | type |
| `extensionRuntimeRequirementSchema` | const |
| `extensionRuntimeRequirementTypeSchema` | const |
| `ExtensionRuntimeUnregisterContributionOperationResult` | type |
| `ExtensionRuntimeUnregisterContributionPayload` | type |
| `extensionRuntimeUnregisterContributionPayloadSchema` | const |
| `ExtensionRuntimeUnregisterContributionResult` | type |
| `extensionRuntimeUnregisterContributionResultSchema` | const |
| `ExtensionSdkIdentity` | interface |
| `ExtensionSdkInvoke` | type |
| `ExtensionSdkInvokeRequest` | interface |
| `ExtensionSelectedStateReadResult` | interface |
| `ExtensionSelectProjectOperationResult` | type |
| `extensionSemverVersionSchema` | const |
| `ExtensionSessionInvokeScope` | type |
| `ExtensionSessionResourceKind` | type |
| `extensionSessionResourceKindSchema` | const |
| `ExtensionSessionResourcePublishOperationResult` | type |
| `ExtensionSessionResourcePublishPayload` | type |
| `extensionSessionResourcePublishPayloadSchema` | const |
| `ExtensionSessionResourcePublishResult` | type |
| `extensionSessionResourcePublishResultSchema` | const |
| `ExtensionSessionResourceRole` | type |
| `extensionSessionResourceRoleSchema` | const |
| `ExtensionSessionResourcesListOperationResult` | type |
| `ExtensionSessionResourcesListPayload` | type |
| `extensionSessionResourcesListPayloadSchema` | const |
| `ExtensionSessionResourcesListResult` | type |
| `extensionSessionResourcesListResultSchema` | const |
| `ExtensionSessionResourceView` | type |
| `extensionSessionResourceViewSchema` | const |
| `extensionSessionSummaryActionSchema` | const |
| `ExtensionSessionSummaryContribution` | type |
| `extensionSessionSummaryContributionRegistrationSchema` | const |
| `extensionSessionSummaryContributionSchema` | const |
| `extensionSessionSummaryDisclosureSchema` | const |
| `extensionSessionSummaryRowSchema` | const |
| `extensionSessionSummaryStateSchema` | const |
| `ExtensionSessionView` | type |
| `extensionSessionViewSchema` | const |
| `extensionSettingsGetModelPreferencesPayloadSchema` | const |
| `ExtensionSettingsGetOperationResult` | type |
| `extensionSettingsGetPayloadSchema` | const |
| `extensionSettingsGetProjectDisplayNamePayloadSchema` | const |
| `ExtensionSettingsGetResult` | type |
| `extensionSettingsGetResultSchema` | const |
| `ExtensionSettingsGetSettingOperationResult` | type |
| `ExtensionSettingsGetSettingResult` | type |
| `extensionSettingsGetSettingResultSchema` | const |
| `ExtensionSettingsKey` | type |
| `extensionSettingsModelPreferencesValueSchema` | const |
| `extensionSettingsProjectDisplayNameValueSchema` | const |
| `ExtensionSettingsSelectedValue` | type |
| `extensionSettingsSelectedValueSchema` | const |
| `extensionSettingsUpdateModelPreferencesPayloadSchema` | const |
| `ExtensionSettingsUpdateOperationResult` | type |
| `ExtensionSettingsUpdatePayload` | type |
| `extensionSettingsUpdatePayloadSchema` | const |
| `extensionSettingsUpdateProjectDisplayNamePayloadSchema` | const |
| `ExtensionSettingsUpdateResult` | type |
| `extensionSettingsUpdateResultSchema` | const |
| `ExtensionSettingsUpdateSettingOperationResult` | type |
| `extensionSettingsUpdateSettingPayloadSchema` | const |
| `ExtensionSettingsUpdateSettingResult` | type |
| `extensionSettingsUpdateSettingResultSchema` | const |
| `ExtensionSettingsView` | type |
| `extensionSettingsViewSchema` | const |
| `ExtensionSidePanelContribution` | type |
| `extensionSidePanelContributionRegistrationSchema` | const |
| `extensionSidePanelContributionSchema` | const |
| `ExtensionSidePanelIcon` | type |
| `extensionSidePanelIconSchema` | const |
| `extensionSlotContributionFamilySchema` | const |
| `extensionSlotContributionRegistrationSchema` | const |
| `extensionSlotContributionSchema` | const |
| `ExtensionStateCurrentBranchReadOperationResult` | type |
| `ExtensionStateCurrentBranchReadResult` | type |
| `extensionStateCurrentBranchReadResultSchema` | const |
| `ExtensionStateCurrentProjectReadOperationResult` | type |
| `ExtensionStateCurrentProjectReadResult` | type |
| `extensionStateCurrentProjectReadResultSchema` | const |
| `ExtensionStateCurrentSessionReadOperationResult` | type |
| `ExtensionStateCurrentSessionReadResult` | type |
| `extensionStateCurrentSessionReadResultSchema` | const |
| `ExtensionStateModelPreferencesReadOperationResult` | type |
| `ExtensionStateModelPreferencesReadResult` | type |
| `extensionStateModelPreferencesReadResultSchema` | const |
| `ExtensionStateReadOperationResult` | type |
| `extensionStateReadPayloadSchema` | const |
| `ExtensionStateReadResult` | type |
| `extensionStateReadResultSchema` | const |
| `ExtensionStateRecentProjectsReadOperationResult` | type |
| `ExtensionStateRecentProjectsReadResult` | type |
| `extensionStateRecentProjectsReadResultSchema` | const |
| `extensionStateSelectedReadResultSchema` | const |
| `ExtensionStateSelector` | type |
| `extensionStateSelectorSchema` | const |
| `ExtensionStorageDeleteOperationResult` | type |
| `extensionStorageDeletePayloadSchema` | const |
| `ExtensionStorageDeleteResult` | type |
| `extensionStorageDeleteResultSchema` | const |
| `ExtensionStorageGetOperationResult` | type |
| `extensionStorageGetPayloadSchema` | const |
| `ExtensionStorageGetResult` | type |
| `extensionStorageGetResultSchema` | const |
| `extensionStorageGlobalScopeSchema` | const |
| `ExtensionStorageKind` | type |
| `extensionStorageKindSchema` | const |
| `ExtensionStorageListOperationResult` | type |
| `extensionStorageListPayloadSchema` | const |
| `ExtensionStorageListResult` | type |
| `extensionStorageListResultSchema` | const |
| `extensionStorageProjectScopeSchema` | const |
| `ExtensionStorageResultBase` | type |
| `ExtensionStorageScope` | type |
| `extensionStorageScopeSchema` | const |
| `ExtensionStorageScopeSdk` | interface |
| `ExtensionStorageScopeSelector` | type |
| `extensionStorageScopeSelectorSchema` | const |
| `ExtensionStorageSetOperationResult` | type |
| `extensionStorageSetPayloadSchema` | const |
| `ExtensionStorageSetResult` | type |
| `extensionStorageSetResultSchema` | const |
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
| `nonEmptyStringSchema` | const |
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
| `OpenWaggleInteractionSurfaceInput` | interface |
| `openWaggleInteractionSurfaceInputSchema` | const |
| `OpenWaggleStatusSurfaceInput` | interface |
| `openWaggleStatusSurfaceInputSchema` | const |
| `OpenWaggleToolCallSurfaceInput` | interface |
| `openWaggleToolCallSurfaceInputSchema` | const |
| `OpenWaggleTranscriptSurfaceInput` | interface |
| `openWaggleTranscriptSurfaceInputSchema` | const |
| `toInvokeInput` | const |
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
| `ExtensionCapabilityAuditEntry` | type |
| `extensionCapabilityAuditEntrySchema` | const |
| `ExtensionDocsDiscoverOperationResult` | type |
| `ExtensionDocsResolveTopicOperationResult` | type |
| `ExtensionInvokeError` | type |
| `extensionInvokeErrorSchema` | const |
| `ExtensionInvokeFailure` | type |
| `ExtensionInvokeFailureCode` | type |
| `extensionInvokeFailureSchema` | const |
| `ExtensionInvokeInput` | type |
| `extensionInvokeInputSchema` | const |
| `ExtensionInvokeOutcome` | type |
| `ExtensionInvokeResult` | type |
| `extensionInvokeResultSchema` | const |
| `ExtensionInvokeScope` | type |
| `extensionInvokeScopeSchema` | const |
| `ExtensionInvokeSuccess` | type |
| `extensionInvokeSuccessSchema` | const |
| `ExtensionInvokeSuccessValue` | type |
| `ExtensionOpenWaggleResourcesSdk` | interface |
| `ExtensionOpenWaggleSdk` | interface |
| `ExtensionOpenWaggleSessionResourcesSdk` | type |
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
| `ExtensionSessionInvokeScope` | type |
| `ExtensionSessionResourcePublishOperationResult` | type |
| `ExtensionSessionResourcesListOperationResult` | type |
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
| `toInvokeInput` | const |

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
| `extensionSessionSummaryActionSchema` | const |
| `ExtensionSessionSummaryContribution` | type |
| `extensionSessionSummaryContributionRegistrationSchema` | const |
| `extensionSessionSummaryContributionSchema` | const |
| `extensionSessionSummaryDisclosureSchema` | const |
| `extensionSessionSummaryRowSchema` | const |
| `extensionSessionSummaryStateSchema` | const |
| `ExtensionSidePanelContribution` | type |
| `extensionSidePanelContributionRegistrationSchema` | const |
| `extensionSidePanelContributionSchema` | const |
| `ExtensionSidePanelIcon` | type |
| `extensionSidePanelIconSchema` | const |
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
| `ExtensionRuntimeRegisterContributionResult` | type |
| `extensionRuntimeRegisterContributionResultSchema` | const |
| `ExtensionRuntimeUnregisterContributionResult` | type |
| `extensionRuntimeUnregisterContributionResultSchema` | const |

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
| `ExtensionInvokeError` | type |
| `ExtensionInvokeFailure` | type |
| `ExtensionInvokeFailureCode` | type |
| `ExtensionInvokeInput` | type |
| `ExtensionInvokeOutcome` | type |
| `ExtensionInvokeResult` | type |
| `ExtensionInvokeScope` | type |
| `ExtensionInvokeSuccess` | type |
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
