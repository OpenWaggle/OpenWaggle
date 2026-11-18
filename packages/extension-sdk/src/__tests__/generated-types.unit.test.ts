// Generated from src/internal/type-sources by scripts/generate-extension-sdk-types.ts;
// do not edit. Regenerate with `bun run extension-sdk-types:generate`; the
// `extension-sdk-types` check step fails when this file no longer matches the schemas.

import { describe, expectTypeOf, it } from 'vitest'
import type * as agentLoopGenerated from '../generated/agent-loop'
import type * as agentLoopSource from '../internal/type-sources/agent-loop'
import type * as brokerResultGenerated from '../generated/broker-result'
import type * as brokerResultSource from '../internal/type-sources/broker-result'
import type * as brokerGenerated from '../generated/broker'
import type * as brokerSource from '../internal/type-sources/broker'
import type * as docsGenerated from '../generated/docs'
import type * as docsSource from '../internal/type-sources/docs'
import type * as manifestGenerated from '../generated/manifest'
import type * as manifestSource from '../internal/type-sources/manifest'
import type * as openwaggleGenerated from '../generated/openwaggle'
import type * as openwaggleSource from '../internal/type-sources/openwaggle'
import type * as storageGenerated from '../generated/storage'
import type * as storageSource from '../internal/type-sources/storage'

describe('the generated public types', () => {
  // Guards the printer: a printed type that drops a readonly, an optional or a member fails here.
  it('equal the schema types they are printed from', () => {
    expectTypeOf<agentLoopGenerated.OpenWaggleToolCallSurfaceInput>().toEqualTypeOf<agentLoopSource.OpenWaggleToolCallSurfaceInput>()
    expectTypeOf<agentLoopGenerated.OpenWaggleCustomMessageSurfaceInput>().toEqualTypeOf<agentLoopSource.OpenWaggleCustomMessageSurfaceInput>()
    expectTypeOf<agentLoopGenerated.OpenWaggleInteractionSurfaceInput>().toEqualTypeOf<agentLoopSource.OpenWaggleInteractionSurfaceInput>()
    expectTypeOf<agentLoopGenerated.OpenWaggleTranscriptSurfaceInput>().toEqualTypeOf<agentLoopSource.OpenWaggleTranscriptSurfaceInput>()
    expectTypeOf<agentLoopGenerated.OpenWaggleStatusSurfaceInput>().toEqualTypeOf<agentLoopSource.OpenWaggleStatusSurfaceInput>()
    expectTypeOf<agentLoopGenerated.OpenWaggleAgentLoopSurfaceInput>().toEqualTypeOf<agentLoopSource.OpenWaggleAgentLoopSurfaceInput>()
    expectTypeOf<brokerResultGenerated.ExtensionInvokeSuccessValue>().toEqualTypeOf<brokerResultSource.ExtensionInvokeSuccessValue>()
    expectTypeOf<brokerGenerated.ExtensionInvokeFailureCode>().toEqualTypeOf<brokerSource.ExtensionInvokeFailureCode>()
    expectTypeOf<brokerGenerated.ExtensionInvokeOutcome>().toEqualTypeOf<brokerSource.ExtensionInvokeOutcome>()
    expectTypeOf<brokerGenerated.ExtensionInvokeScope>().toEqualTypeOf<brokerSource.ExtensionInvokeScope>()
    expectTypeOf<brokerGenerated.ExtensionInvokeInput>().toEqualTypeOf<brokerSource.ExtensionInvokeInput>()
    expectTypeOf<brokerGenerated.ExtensionInvokeError>().toEqualTypeOf<brokerSource.ExtensionInvokeError>()
    expectTypeOf<brokerGenerated.ExtensionCapabilityAuditEntry>().toEqualTypeOf<brokerSource.ExtensionCapabilityAuditEntry>()
    expectTypeOf<brokerGenerated.ExtensionInvokeFailure>().toEqualTypeOf<brokerSource.ExtensionInvokeFailure>()
    expectTypeOf<brokerGenerated.ExtensionHostContextResult>().toEqualTypeOf<brokerSource.ExtensionHostContextResult>()
    expectTypeOf<docsGenerated.ExtensionDocsDiscoverPayload>().toEqualTypeOf<docsSource.ExtensionDocsDiscoverPayload>()
    expectTypeOf<docsGenerated.ExtensionDocsResolveTopicPayload>().toEqualTypeOf<docsSource.ExtensionDocsResolveTopicPayload>()
    expectTypeOf<docsGenerated.ExtensionDocsDiscoverResult>().toEqualTypeOf<docsSource.ExtensionDocsDiscoverResult>()
    expectTypeOf<docsGenerated.ExtensionDocsResolveTopicResult>().toEqualTypeOf<docsSource.ExtensionDocsResolveTopicResult>()
    expectTypeOf<docsGenerated.ExtensionDocsDiscoveryView>().toEqualTypeOf<docsSource.ExtensionDocsDiscoveryView>()
    expectTypeOf<docsGenerated.FirstPartyDocsTopicSummary>().toEqualTypeOf<docsSource.FirstPartyDocsTopicSummary>()
    expectTypeOf<manifestGenerated.ExtensionCapabilityScope>().toEqualTypeOf<manifestSource.ExtensionCapabilityScope>()
    expectTypeOf<manifestGenerated.ExtensionContributionFamily>().toEqualTypeOf<manifestSource.ExtensionContributionFamily>()
    expectTypeOf<manifestGenerated.ExtensionContributionRuntime>().toEqualTypeOf<manifestSource.ExtensionContributionRuntime>()
    expectTypeOf<manifestGenerated.ExtensionExecutionPlacement>().toEqualTypeOf<manifestSource.ExtensionExecutionPlacement>()
    expectTypeOf<manifestGenerated.ExtensionInstallSource>().toEqualTypeOf<manifestSource.ExtensionInstallSource>()
    expectTypeOf<manifestGenerated.ExtensionContributionTargetView>().toEqualTypeOf<manifestSource.ExtensionContributionTargetView>()
    expectTypeOf<manifestGenerated.ExtensionContributionMatchView>().toEqualTypeOf<manifestSource.ExtensionContributionMatchView>()
    expectTypeOf<manifestGenerated.ExtensionCapabilityDeclaration>().toEqualTypeOf<manifestSource.ExtensionCapabilityDeclaration>()
    expectTypeOf<manifestGenerated.ExtensionCommandContribution>().toEqualTypeOf<manifestSource.ExtensionCommandContribution>()
    expectTypeOf<manifestGenerated.ExtensionSurfaceContribution>().toEqualTypeOf<manifestSource.ExtensionSurfaceContribution>()
    expectTypeOf<manifestGenerated.ExtensionSidePanelIcon>().toEqualTypeOf<manifestSource.ExtensionSidePanelIcon>()
    expectTypeOf<manifestGenerated.ExtensionSidePanelContribution>().toEqualTypeOf<manifestSource.ExtensionSidePanelContribution>()
    expectTypeOf<manifestGenerated.ExtensionEntryContribution>().toEqualTypeOf<manifestSource.ExtensionEntryContribution>()
    expectTypeOf<manifestGenerated.ExtensionSessionSummaryRow>().toEqualTypeOf<manifestSource.ExtensionSessionSummaryRow>()
    expectTypeOf<manifestGenerated.ExtensionSessionSummaryDisclosure>().toEqualTypeOf<manifestSource.ExtensionSessionSummaryDisclosure>()
    expectTypeOf<manifestGenerated.ExtensionSessionSummaryState>().toEqualTypeOf<manifestSource.ExtensionSessionSummaryState>()
    expectTypeOf<manifestGenerated.ExtensionSessionSummaryContribution>().toEqualTypeOf<manifestSource.ExtensionSessionSummaryContribution>()
    expectTypeOf<manifestGenerated.ExtensionContributions>().toEqualTypeOf<manifestSource.ExtensionContributions>()
    expectTypeOf<manifestGenerated.ExtensionContributionRegistration>().toEqualTypeOf<manifestSource.ExtensionContributionRegistration>()
    expectTypeOf<manifestGenerated.ExtensionContributionUnregistration>().toEqualTypeOf<manifestSource.ExtensionContributionUnregistration>()
    expectTypeOf<manifestGenerated.ExtensionRuntimeRequirementDeclaration>().toEqualTypeOf<manifestSource.ExtensionRuntimeRequirementDeclaration>()
    expectTypeOf<manifestGenerated.ExtensionDocsTopicDeclaration>().toEqualTypeOf<manifestSource.ExtensionDocsTopicDeclaration>()
    expectTypeOf<manifestGenerated.OpenWaggleExtensionManifest>().toEqualTypeOf<manifestSource.OpenWaggleExtensionManifest>()
    expectTypeOf<openwaggleGenerated.ExtensionModelPrefs>().toEqualTypeOf<openwaggleSource.ExtensionModelPrefs>()
    expectTypeOf<openwaggleGenerated.ExtensionProjectView>().toEqualTypeOf<openwaggleSource.ExtensionProjectView>()
    expectTypeOf<openwaggleGenerated.ExtensionSessionView>().toEqualTypeOf<openwaggleSource.ExtensionSessionView>()
    expectTypeOf<openwaggleGenerated.ExtensionBranchView>().toEqualTypeOf<openwaggleSource.ExtensionBranchView>()
    expectTypeOf<openwaggleGenerated.ExtensionStateReadResult>().toEqualTypeOf<openwaggleSource.ExtensionStateReadResult>()
    expectTypeOf<openwaggleGenerated.ExtensionStateCurrentProjectReadResult>().toEqualTypeOf<openwaggleSource.ExtensionStateCurrentProjectReadResult>()
    expectTypeOf<openwaggleGenerated.ExtensionStateCurrentSessionReadResult>().toEqualTypeOf<openwaggleSource.ExtensionStateCurrentSessionReadResult>()
    expectTypeOf<openwaggleGenerated.ExtensionStateCurrentBranchReadResult>().toEqualTypeOf<openwaggleSource.ExtensionStateCurrentBranchReadResult>()
    expectTypeOf<openwaggleGenerated.ExtensionStateRecentProjectsReadResult>().toEqualTypeOf<openwaggleSource.ExtensionStateRecentProjectsReadResult>()
    expectTypeOf<openwaggleGenerated.ExtensionStateModelPreferencesReadResult>().toEqualTypeOf<openwaggleSource.ExtensionStateModelPreferencesReadResult>()
    expectTypeOf<openwaggleGenerated.ExtensionActionSelectProjectResult>().toEqualTypeOf<openwaggleSource.ExtensionActionSelectProjectResult>()
    expectTypeOf<openwaggleGenerated.ExtensionSessionResourceKind>().toEqualTypeOf<openwaggleSource.ExtensionSessionResourceKind>()
    expectTypeOf<openwaggleGenerated.ExtensionSessionResourceRole>().toEqualTypeOf<openwaggleSource.ExtensionSessionResourceRole>()
    expectTypeOf<openwaggleGenerated.ExtensionSessionResourceView>().toEqualTypeOf<openwaggleSource.ExtensionSessionResourceView>()
    expectTypeOf<openwaggleGenerated.ExtensionSessionResourcePublishPayload>().toEqualTypeOf<openwaggleSource.ExtensionSessionResourcePublishPayload>()
    expectTypeOf<openwaggleGenerated.ExtensionSessionResourcesListPayload>().toEqualTypeOf<openwaggleSource.ExtensionSessionResourcesListPayload>()
    expectTypeOf<openwaggleGenerated.ExtensionSessionResourcesListResult>().toEqualTypeOf<openwaggleSource.ExtensionSessionResourcesListResult>()
    expectTypeOf<openwaggleGenerated.ExtensionSessionResourcePublishResult>().toEqualTypeOf<openwaggleSource.ExtensionSessionResourcePublishResult>()
    expectTypeOf<openwaggleGenerated.ExtensionSettingsView>().toEqualTypeOf<openwaggleSource.ExtensionSettingsView>()
    expectTypeOf<openwaggleGenerated.ExtensionModelPreferencesSettingsPatch>().toEqualTypeOf<openwaggleSource.ExtensionModelPreferencesSettingsPatch>()
    expectTypeOf<openwaggleGenerated.ExtensionSettingsUpdatePayload>().toEqualTypeOf<openwaggleSource.ExtensionSettingsUpdatePayload>()
    expectTypeOf<openwaggleGenerated.ExtensionSettingsGetResult>().toEqualTypeOf<openwaggleSource.ExtensionSettingsGetResult>()
    expectTypeOf<openwaggleGenerated.ExtensionSettingsUpdateResult>().toEqualTypeOf<openwaggleSource.ExtensionSettingsUpdateResult>()
    expectTypeOf<openwaggleGenerated.ExtensionSettingsSelectedValue>().toEqualTypeOf<openwaggleSource.ExtensionSettingsSelectedValue>()
    expectTypeOf<openwaggleGenerated.ExtensionSettingsGetSettingResult>().toEqualTypeOf<openwaggleSource.ExtensionSettingsGetSettingResult>()
    expectTypeOf<openwaggleGenerated.ExtensionSettingsUpdateSettingResult>().toEqualTypeOf<openwaggleSource.ExtensionSettingsUpdateSettingResult>()
    expectTypeOf<storageGenerated.ExtensionStorageKind>().toEqualTypeOf<storageSource.ExtensionStorageKind>()
    expectTypeOf<storageGenerated.ExtensionStorageScopeSelector>().toEqualTypeOf<storageSource.ExtensionStorageScopeSelector>()
    expectTypeOf<storageGenerated.ExtensionStorageScope>().toEqualTypeOf<storageSource.ExtensionStorageScope>()
    expectTypeOf<storageGenerated.ExtensionStorageGetResult>().toEqualTypeOf<storageSource.ExtensionStorageGetResult>()
    expectTypeOf<storageGenerated.ExtensionStorageSetResult>().toEqualTypeOf<storageSource.ExtensionStorageSetResult>()
    expectTypeOf<storageGenerated.ExtensionStorageDeleteResult>().toEqualTypeOf<storageSource.ExtensionStorageDeleteResult>()
    expectTypeOf<storageGenerated.ExtensionStorageListResult>().toEqualTypeOf<storageSource.ExtensionStorageListResult>()
    expectTypeOf<storageGenerated.ExtensionRuntimeRegisterContributionResult>().toEqualTypeOf<storageSource.ExtensionRuntimeRegisterContributionResult>()
    expectTypeOf<storageGenerated.ExtensionRuntimeUnregisterContributionResult>().toEqualTypeOf<storageSource.ExtensionRuntimeUnregisterContributionResult>()
  })
})
