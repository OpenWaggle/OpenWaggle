import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionLifecycleMutationTarget,
  ExtensionPackageScopeView,
} from './extension-package-scope'

type ConstantValue<TObject> = TObject[keyof TObject]

export type ExtensionDiagnosticSeverity = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY
>
export type ExtensionDiagnosticCode = ConstantValue<typeof OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE>

export interface ExtensionDiagnosticView {
  readonly severity: ExtensionDiagnosticSeverity
  readonly code: ExtensionDiagnosticCode
  readonly message: string
  readonly path?: string
}

export type {
  ExtensionContributionEligibilityView,
  ExtensionContributionMatchView,
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionContributionTargetView,
  ExtensionListContributionsInput,
} from './extension-contribution-registry'
export type {
  ExtensionLifecycleMutationTarget,
  ExtensionPackageLifecycleScope,
  ExtensionPackageScopeKind,
  ExtensionPackageScopeView,
} from './extension-package-scope'
export type {
  ExtensionApplyPackageRemoveInput,
  ExtensionApplyPackageWriteInput,
  ExtensionPackageFileWrite,
  ExtensionPackageRemoveOperation,
  ExtensionPackageRemoveProposalView,
  ExtensionPackageWorkflowActor,
  ExtensionPackageWorkflowGlobalConfirmation,
  ExtensionPackageWorkflowUserApproval,
  ExtensionPackageWriteMode,
  ExtensionPackageWriteOperation,
  ExtensionPackageWriteProposalFileView,
  ExtensionPackageWriteProposalView,
  ExtensionProposePackageRemoveInput,
  ExtensionProposePackageWriteInput,
} from './extension-package-workflow'

export interface ExtensionListPackagesInput {
  readonly projectPaths?: readonly string[]
}

export interface ExtensionSetTrustedInput extends ExtensionLifecycleMutationTarget {
  readonly trusted: boolean
}

export interface ExtensionSetEnabledInput extends ExtensionLifecycleMutationTarget {
  readonly enabled: boolean
}

export interface ExtensionSetProjectDisabledInput extends ExtensionLifecycleMutationTarget {
  readonly projectPath: string
  readonly disabled: boolean
}

export type ExtensionAcceptUpdateInput = ExtensionLifecycleMutationTarget
export type ExtensionApproveBuildInput = ExtensionLifecycleMutationTarget
export type ExtensionReloadInput = ExtensionLifecycleMutationTarget

export interface ExtensionSdkCompatibilityView {
  readonly hostVersion: string
  readonly requiredRange: string
  readonly compatible: boolean
  readonly reason?: string
}

export interface ExtensionManifestSummary {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly sdkRange: string
  readonly sourceFileCount: number
  readonly builtArtifactCount: number
  readonly capabilityCount: number
  readonly contributionCount: number
  readonly piResourceRootCount: number
  readonly trustedMain: boolean
  readonly trustedRenderer: boolean
  readonly runtimeRequirementCount: number
}

export type ExtensionInstallSource = ConstantValue<typeof OPENWAGGLE_EXTENSION.INSTALL_SOURCE>
export type ExtensionBuildRunStatus = ConstantValue<typeof OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS>
export type ExtensionReloadStatus = ConstantValue<typeof OPENWAGGLE_EXTENSION.RELOAD_STATUS>
export type ExtensionRequirementKind = ConstantValue<typeof OPENWAGGLE_EXTENSION.REQUIREMENT_KIND>
export type ExtensionRuntimeRequirementDeclarationKind = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_TYPE
>
export type ExtensionRuntimeRequirementResolution = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_RESOLUTION
>
export type ExtensionPrivilegeGrantId = ConstantValue<typeof OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT>
export type ExtensionNetworkAccessMode = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE
>
export type ExtensionContributionFamily = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY
>
export type ExtensionContributionRuntime = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME
>
export type ExtensionExecutionPlacement = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT
>
export type ExtensionCapabilityScope = (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number]

export interface ExtensionBuildPlanView {
  readonly installSource: ExtensionInstallSource
  readonly command: string | null
  readonly outputCount: number
  readonly approvalRequired: boolean
  readonly approved: boolean
  readonly inputHash: string | null
}

export interface ExtensionRuntimeBinaryRequirementView {
  readonly kind: typeof OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_BINARY
  readonly id: string
  readonly label: string
  readonly resolution: typeof OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_RESOLUTION.DIAGNOSTIC_ONLY
  readonly binary: string
}

export interface ExtensionRuntimeCommandRequirementView {
  readonly kind: typeof OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_COMMAND
  readonly id: string
  readonly label: string
  readonly resolution: typeof OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_RESOLUTION.DIAGNOSTIC_ONLY
  readonly path: string
}

export type ExtensionRuntimeRequirementView =
  | ExtensionRuntimeBinaryRequirementView
  | ExtensionRuntimeCommandRequirementView

export interface ExtensionCapabilityRequirementView {
  readonly kind: typeof OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_CAPABILITY
  readonly id: string
  readonly label: string
  readonly grantId: string
  readonly consentRequired: true
  readonly granted: boolean
  readonly capabilityId: string
  readonly methods?: readonly string[]
  readonly scopes?: readonly string[]
}

export interface ExtensionNetworkRequirementView {
  readonly kind: typeof OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_NETWORK
  readonly id: typeof OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK
  readonly label: string
  readonly grantId: typeof OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK
  readonly consentRequired: true
  readonly granted: boolean
  readonly origins: readonly string[]
  readonly accessModes: readonly ExtensionNetworkAccessMode[]
}

export interface ExtensionLocalBuildRequirementView {
  readonly kind: typeof OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_LOCAL_BUILD
  readonly id: typeof OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD
  readonly label: string
  readonly grantId: typeof OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD
  readonly consentRequired: true
  readonly granted: boolean
  readonly command: string | null
  readonly outputCount: number
}

export interface ExtensionTrustedMainRequirementView {
  readonly kind: typeof OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_MAIN
  readonly id: typeof OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN
  readonly label: string
  readonly grantId: typeof OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN
  readonly consentRequired: true
  readonly granted: boolean
  readonly path: string
}

export interface ExtensionTrustedRendererRequirementView {
  readonly kind: typeof OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_RENDERER
  readonly id: typeof OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER
  readonly label: string
  readonly grantId: typeof OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER
  readonly consentRequired: true
  readonly granted: boolean
  readonly path: string
}

export type ExtensionPrivilegeRequirementView =
  | ExtensionCapabilityRequirementView
  | ExtensionNetworkRequirementView
  | ExtensionLocalBuildRequirementView
  | ExtensionTrustedMainRequirementView
  | ExtensionTrustedRendererRequirementView

export interface ExtensionPackageRequirementsView {
  readonly runtime: readonly ExtensionRuntimeRequirementView[]
  readonly privileges: readonly ExtensionPrivilegeRequirementView[]
  readonly consentRequired: boolean
  readonly missingGrantIds: readonly string[]
}

export interface ExtensionLifecycleView {
  readonly enabled: boolean
  readonly trusted: boolean
  readonly updateAvailable: boolean
  readonly grantedCapabilities: readonly string[]
  readonly contentHash: string | null
  readonly packageVersion: string | null
  readonly approvedBuildPlanHash: string | null
  readonly buildStatus: ExtensionBuildRunStatus
  readonly buildLog: string | null
  readonly reloadStatus: ExtensionReloadStatus
  readonly lastReloadedAt: number | null
  readonly sdkRange: string | null
  readonly sdkCompatible: boolean
  readonly diagnostics: readonly ExtensionDiagnosticView[]
  readonly installedAt: number
  readonly updatedAt: number
}

export interface ExtensionProjectOverrideView {
  readonly projectPath: string
  readonly disabled: boolean
  readonly updatedAt: number | null
}

export interface ExtensionPackageSummary {
  readonly id: string
  readonly scope: ExtensionPackageScopeView
  readonly packagePath: string
  readonly manifestPath: string
  readonly manifest: ExtensionManifestSummary | null
  readonly buildPlan: ExtensionBuildPlanView | null
  readonly requirements?: ExtensionPackageRequirementsView
  readonly contentHash: string | null
  readonly sdkCompatibility: ExtensionSdkCompatibilityView | null
  readonly lifecycle: ExtensionLifecycleView | null
  readonly projectOverride: ExtensionProjectOverrideView | null
  readonly projectOverrides: readonly ExtensionProjectOverrideView[]
  readonly diagnostics: readonly ExtensionDiagnosticView[]
}

export interface ExtensionManagerView {
  readonly projectPath: string | null
  readonly projectPaths: readonly string[]
  readonly packages: readonly ExtensionPackageSummary[]
}
