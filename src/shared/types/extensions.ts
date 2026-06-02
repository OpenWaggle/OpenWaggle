import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

export type ExtensionPackageScopeKind =
  | typeof OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
  | typeof OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND

export type ExtensionDiagnosticSeverity =
  (typeof OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITIES)[number]
export type ExtensionDiagnosticCode = (typeof OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODES)[number]

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

export interface ExtensionLifecycleView {
  readonly enabled: boolean
  readonly trusted: boolean
  readonly grantedCapabilities: readonly string[]
  readonly contentHash: string | null
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
