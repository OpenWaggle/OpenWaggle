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
export type ExtensionContributionFamily = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY
>
export type ExtensionContributionUiLane = (typeof OPENWAGGLE_EXTENSION.UI_LANES)[number]

export interface ExtensionBuildPlanView {
  readonly installSource: ExtensionInstallSource
  readonly command: string | null
  readonly outputCount: number
  readonly approvalRequired: boolean
  readonly approved: boolean
  readonly inputHash: string | null
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
}

export interface ExtensionContributionEligibilityView {
  readonly runtimeEnabled: boolean
  readonly enabled: boolean
  readonly trusted: boolean
  readonly sdkCompatible: boolean | null
  readonly updateAvailable: boolean
  readonly disabledProjectPaths: readonly string[]
}

export interface ExtensionContributionRegistryEntry {
  readonly extensionId: string
  readonly extensionName: string
  readonly extensionVersion: string
  readonly scope: ExtensionPackageScopeView
  readonly packagePath: string
  readonly manifestPath: string
  readonly projectPaths: readonly string[]
  readonly appliesToAllRequestedProjects: boolean
  readonly family: ExtensionContributionFamily
  readonly contributionId: string
  readonly title: string
  readonly label: string
  readonly category?: string
  readonly capability?: string
  readonly method?: string
  readonly methods?: readonly string[]
  readonly lane?: ExtensionContributionUiLane
  readonly entryPath?: string
  readonly eligibility: ExtensionContributionEligibilityView
  readonly diagnostics: readonly ExtensionDiagnosticView[]
}

export interface ExtensionContributionRegistryView {
  readonly projectPaths: readonly string[]
  readonly entries: readonly ExtensionContributionRegistryEntry[]
}
