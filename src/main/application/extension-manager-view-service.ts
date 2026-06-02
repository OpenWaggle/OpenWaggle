import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributions } from '@shared/schemas/extensions'
import type {
  ExtensionDiagnosticView,
  ExtensionLifecycleView,
  ExtensionManagerView,
  ExtensionManifestSummary,
  ExtensionPackageScopeView,
  ExtensionPackageSummary,
  ExtensionSdkCompatibilityView,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import type {
  DiscoveredExtensionPackage,
  ExtensionDiagnostic,
  ExtensionLifecycleState,
  ExtensionPackageScope,
} from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../ports/extension-manager-service'

function scopeToView(scope: ExtensionPackageScope): ExtensionPackageScopeView {
  if (scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return {
      kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
      label: 'Global',
    }
  }

  return {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    label: 'Project',
    projectPath: scope.projectPath,
  }
}

function contributionCount(entries: readonly unknown[] | undefined) {
  return entries ? entries.length : 0
}

function countContributionFamilies(contributions: ExtensionContributions | undefined) {
  if (!contributions) {
    return 0
  }

  return (
    contributionCount(contributions.commands) +
    contributionCount(contributions.slashCommands) +
    contributionCount(contributions.routes) +
    contributionCount(contributions.settingsSections) +
    contributionCount(contributions.sidePanels) +
    contributionCount(contributions.dialogs) +
    contributionCount(contributions.transcriptRenderers) +
    contributionCount(contributions.statusWidgets)
  )
}

function manifestToSummary(
  manifest: NonNullable<DiscoveredExtensionPackage['manifest']>,
): ExtensionManifestSummary {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    sdkRange: manifest.sdk.openwaggle,
    sourceFileCount: manifest.sourceFiles.length,
    builtArtifactCount: manifest.builtArtifacts.length,
    capabilityCount: manifest.capabilities?.length ?? 0,
    contributionCount: countContributionFamilies(manifest.contributions),
    piResourceRootCount: manifest.pi?.resourceRoots?.length ?? 0,
    trustedMain: manifest.trusted?.main !== undefined,
    trustedRenderer: manifest.trusted?.renderer !== undefined,
    runtimeRequirementCount: manifest.runtimeRequirements?.length ?? 0,
  }
}

function diagnosticsToView(
  diagnostics: readonly ExtensionDiagnostic[],
): readonly ExtensionDiagnosticView[] {
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.path !== undefined ? { path: diagnostic.path } : {}),
  }))
}

function hasErrorDiagnostics(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

function lifecycleToView(
  state: ExtensionLifecycleState,
  extensionPackage: DiscoveredExtensionPackage,
): ExtensionLifecycleView {
  const isCurrentTrustPin =
    state.trusted &&
    extensionPackage.contentHash !== null &&
    state.contentHash === extensionPackage.contentHash &&
    extensionPackage.sdkCompatibility?.compatible === true &&
    !hasErrorDiagnostics(extensionPackage)

  return {
    enabled: isCurrentTrustPin ? state.enabled : false,
    trusted: isCurrentTrustPin,
    grantedCapabilities: isCurrentTrustPin ? state.grantedCapabilities : [],
    contentHash: state.contentHash,
    sdkRange: state.sdkRange,
    sdkCompatible: state.sdkCompatible,
    diagnostics: diagnosticsToView(state.diagnostics),
    installedAt: state.installedAt,
    updatedAt: state.updatedAt,
  }
}

function sdkCompatibilityToView(
  compatibility: DiscoveredExtensionPackage['sdkCompatibility'],
): ExtensionSdkCompatibilityView | null {
  if (!compatibility) {
    return null
  }

  return {
    hostVersion: compatibility.hostVersion,
    requiredRange: compatibility.requiredRange,
    compatible: compatibility.compatible,
    ...(compatibility.reason !== undefined ? { reason: compatibility.reason } : {}),
  }
}

function packageToSummary(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState | null,
): ExtensionPackageSummary {
  return {
    id: extensionPackage.id,
    scope: scopeToView(extensionPackage.scope),
    packagePath: extensionPackage.packagePath,
    manifestPath: extensionPackage.manifestPath,
    manifest: extensionPackage.manifest ? manifestToSummary(extensionPackage.manifest) : null,
    contentHash: extensionPackage.contentHash,
    sdkCompatibility: sdkCompatibilityToView(extensionPackage.sdkCompatibility),
    lifecycle: lifecycle ? lifecycleToView(lifecycle, extensionPackage) : null,
    diagnostics: diagnosticsToView(extensionPackage.diagnostics),
  }
}

export function listExtensionPackagesView(projectPath: string | null) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const packages = yield* manager.listPackages({ projectPath })
    const summaries = yield* Effect.forEach(packages, (extensionPackage) =>
      Effect.gen(function* () {
        const lifecycle = yield* lifecycleRepository.get({
          extensionId: extensionPackage.id,
          scope: extensionPackage.scope,
        })
        return packageToSummary(extensionPackage, lifecycle)
      }),
    )

    return {
      projectPath,
      packages: summaries,
    } satisfies ExtensionManagerView
  })
}
