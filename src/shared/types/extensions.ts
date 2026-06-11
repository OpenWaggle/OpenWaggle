import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

type ConstantValue<TObject> = TObject[keyof TObject]

export type ExtensionPackageScopeKind =
  | typeof OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
  | typeof OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND

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

export interface ExtensionPackageScopeView {
  readonly kind: ExtensionPackageScopeKind
  readonly label: string
  readonly projectPath?: string
}

export type ExtensionPackageLifecycleScope =
  | {
      readonly kind: typeof OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    }
  | {
      readonly kind: typeof OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
      readonly projectPath: string
    }

export interface ExtensionLifecycleMutationTarget {
  readonly extensionId: string
  readonly scope: ExtensionPackageLifecycleScope
  readonly viewProjectPaths?: readonly string[]
}

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

export interface ExtensionListContributionsInput {
  readonly projectPaths?: readonly string[]
  readonly sessionId?: string
}

export interface ExtensionContributionEligibilityView {
  readonly runtimeEnabled: boolean
  readonly enabled: boolean
  readonly trusted: boolean
  readonly sdkCompatible: boolean | null
  readonly updateAvailable: boolean
  readonly disabledProjectPaths: readonly string[]
}

export interface ExtensionContributionTargetView {
  readonly projectPaths?: readonly string[]
  readonly sessionIds?: readonly string[]
}

export interface ExtensionContributionMatchView {
  readonly toolNames?: readonly string[]
  readonly customMessageNames?: readonly string[]
  readonly interactionKinds?: readonly string[]
}

export interface ExtensionContributionRegistryEntry {
  readonly extensionId: string
  readonly extensionName: string
  readonly extensionVersion: string
  readonly scope: ExtensionPackageScopeView
  readonly packagePath: string
  readonly manifestPath: string
  readonly contentHash: string
  readonly projectPaths: readonly string[]
  readonly sessionId?: string
  readonly appliesToAllRequestedProjects: boolean
  readonly family: ExtensionContributionFamily
  readonly contributionId: string
  readonly title: string
  readonly label: string
  readonly category?: string
  readonly capability?: string
  readonly method?: string
  readonly methods?: readonly string[]
  readonly declaredScopes?: readonly ExtensionCapabilityScope[]
  readonly networkOrigins?: readonly string[]
  readonly target?: ExtensionContributionTargetView
  readonly matches?: ExtensionContributionMatchView
  readonly runtime?: ExtensionContributionRuntime
  readonly execution?: ExtensionExecutionPlacement
  readonly entryPath?: string
  readonly eligibility: ExtensionContributionEligibilityView
  readonly diagnostics: readonly ExtensionDiagnosticView[]
}

export interface ExtensionContributionRegistryView {
  readonly projectPaths: readonly string[]
  readonly entries: readonly ExtensionContributionRegistryEntry[]
  readonly diagnostics?: readonly ExtensionDiagnosticView[]
}
