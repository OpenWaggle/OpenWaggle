import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { OpenWaggleExtensionManifest } from '@shared/schemas/extensions'

type ConstantValue<TObject> = TObject[keyof TObject]

export type ExtensionPackageScope =
  | {
      readonly kind: typeof OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    }
  | {
      readonly kind: typeof OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
      readonly projectPath: string
    }

export type ExtensionDiagnosticSeverity = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY
>
export type ExtensionDiagnosticCode = ConstantValue<typeof OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE>

export interface ExtensionDiagnostic {
  readonly severity: ExtensionDiagnosticSeverity
  readonly code: ExtensionDiagnosticCode
  readonly message: string
  readonly path?: string
}

export interface ExtensionSdkCompatibility {
  readonly hostVersion: string
  readonly requiredRange: string
  readonly compatible: boolean
  readonly reason?: string
}

export type ExtensionInstallSource = ConstantValue<typeof OPENWAGGLE_EXTENSION.INSTALL_SOURCE>
export type ExtensionBuildRunStatus = ConstantValue<typeof OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS>
export type ExtensionReloadStatus = ConstantValue<typeof OPENWAGGLE_EXTENSION.RELOAD_STATUS>

export interface ExtensionBuildPlan {
  readonly installSource: ExtensionInstallSource
  readonly command: string | null
  readonly outputPaths: readonly string[]
  readonly approvalRequired: boolean
  readonly inputHash: string | null
}

export interface DiscoveredExtensionPackage {
  readonly id: string
  readonly scope: ExtensionPackageScope
  readonly packagePath: string
  readonly manifestPath: string
  readonly manifest: OpenWaggleExtensionManifest | null
  readonly buildPlan: ExtensionBuildPlan | null
  readonly contentHash: string | null
  readonly sdkCompatibility: ExtensionSdkCompatibility | null
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

export interface ExtensionDiscoveryRoot {
  readonly scope: ExtensionPackageScope
  readonly rootPath: string
}

export interface ExtensionDiscoveryOptions {
  readonly projectPath?: string | null
  readonly globalRootPath?: string | null
  readonly hostSdkVersion: string
}

export interface ExtensionLifecycleKey {
  readonly extensionId: string
  readonly scope: ExtensionPackageScope
}

export interface ExtensionLifecycleState extends ExtensionLifecycleKey {
  readonly enabled: boolean
  readonly trusted: boolean
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
  readonly diagnostics: readonly ExtensionDiagnostic[]
  readonly installedAt: number
  readonly updatedAt: number
}

export interface ExtensionProjectOverrideKey extends ExtensionLifecycleKey {
  readonly projectPath: string
}

export interface ExtensionProjectOverrideState extends ExtensionProjectOverrideKey {
  readonly disabled: boolean
  readonly createdAt: number
  readonly updatedAt: number
}
