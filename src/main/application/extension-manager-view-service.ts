import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributions } from '@shared/schemas/extensions'
import type {
  ExtensionDiagnosticView,
  ExtensionLifecycleView,
  ExtensionListPackagesInput,
  ExtensionManagerView,
  ExtensionManifestSummary,
  ExtensionPackageScopeView,
  ExtensionPackageSummary,
  ExtensionProjectOverrideView,
  ExtensionSdkCompatibilityView,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import {
  isExtensionCurrentTrustPin,
  isExtensionRuntimeEnabled,
} from '../extensions/runtime-eligibility'
import type {
  DiscoveredExtensionPackage,
  ExtensionDiagnostic,
  ExtensionLifecycleState,
  ExtensionPackageScope,
  ExtensionProjectOverrideState,
} from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'

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

function lifecycleToView(
  state: ExtensionLifecycleState,
  extensionPackage: DiscoveredExtensionPackage,
  projectOverride: { readonly disabled: boolean } | null,
): ExtensionLifecycleView {
  const trusted = isExtensionCurrentTrustPin({ extensionPackage, lifecycle: state })
  const enabled = isExtensionRuntimeEnabled({
    extensionPackage,
    lifecycle: state,
    projectOverride,
  })

  return {
    enabled,
    trusted,
    grantedCapabilities: enabled ? state.grantedCapabilities : [],
    contentHash: state.contentHash,
    sdkRange: state.sdkRange,
    sdkCompatible: state.sdkCompatible,
    diagnostics: diagnosticsToView(state.diagnostics),
    installedAt: state.installedAt,
    updatedAt: state.updatedAt,
  }
}

function projectOverrideToView(
  projectPath: string,
  projectOverride: ExtensionProjectOverrideState | null,
): ExtensionProjectOverrideView {
  return {
    projectPath,
    disabled: projectOverride?.disabled ?? false,
    updatedAt: projectOverride?.updatedAt ?? null,
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
  projectOverride: ExtensionProjectOverrideView | null,
  projectOverrides: readonly ExtensionProjectOverrideView[],
): ExtensionPackageSummary {
  return {
    id: extensionPackage.id,
    scope: scopeToView(extensionPackage.scope),
    packagePath: extensionPackage.packagePath,
    manifestPath: extensionPackage.manifestPath,
    manifest: extensionPackage.manifest ? manifestToSummary(extensionPackage.manifest) : null,
    contentHash: extensionPackage.contentHash,
    sdkCompatibility: sdkCompatibilityToView(extensionPackage.sdkCompatibility),
    lifecycle: lifecycle ? lifecycleToView(lifecycle, extensionPackage, projectOverride) : null,
    projectOverride,
    projectOverrides,
    diagnostics: diagnosticsToView(extensionPackage.diagnostics),
  }
}

function normalizeProjectPaths(projectPaths: readonly string[] | undefined) {
  const normalizedProjectPaths: string[] = []
  for (const projectPath of projectPaths ?? []) {
    const normalized = projectPath.trim()
    if (normalized.length > 0 && !normalizedProjectPaths.includes(normalized)) {
      normalizedProjectPaths.push(normalized)
    }
  }
  return normalizedProjectPaths
}

function isGlobalPackage(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
}

function isProjectPackageForPath(
  extensionPackage: DiscoveredExtensionPackage,
  projectPath: string,
) {
  return (
    extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
    extensionPackage.scope.projectPath === projectPath
  )
}

function loadViewPackages(projectPaths: readonly string[]) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const globalPackages = yield* manager
      .listPackages({ projectPath: null })
      .pipe(Effect.map((packages) => packages.filter(isGlobalPackage)))
    const projectPackageGroups = yield* Effect.forEach(projectPaths, (projectPath) =>
      manager
        .listPackages({ projectPath })
        .pipe(
          Effect.map((packages) =>
            packages.filter((extensionPackage) =>
              isProjectPackageForPath(extensionPackage, projectPath),
            ),
          ),
        ),
    )

    return [...globalPackages, ...projectPackageGroups.flat()]
  })
}

function getOverrideProjectPaths(
  extensionPackage: DiscoveredExtensionPackage,
  projectPaths: readonly string[],
) {
  if (projectPaths.length === 0) {
    return []
  }

  if (extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND) {
    return projectPaths.includes(extensionPackage.scope.projectPath)
      ? [extensionPackage.scope.projectPath]
      : []
  }

  return projectPaths
}

function getPrimaryProjectOverride(
  extensionPackage: DiscoveredExtensionPackage,
  projectOverrides: readonly ExtensionProjectOverrideView[],
) {
  if (extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND) {
    const packageProjectPath = extensionPackage.scope.projectPath
    return (
      projectOverrides.find(
        (projectOverride) => projectOverride.projectPath === packageProjectPath,
      ) ?? null
    )
  }

  return projectOverrides.length === 1 ? (projectOverrides[0] ?? null) : null
}

function loadProjectOverrides(
  extensionPackage: DiscoveredExtensionPackage,
  projectPaths: readonly string[],
) {
  return Effect.gen(function* () {
    const projectOverridesRepository = yield* ExtensionProjectOverridesRepository
    const overrideProjectPaths = getOverrideProjectPaths(extensionPackage, projectPaths)
    return yield* Effect.forEach(overrideProjectPaths, (projectPath) =>
      Effect.gen(function* () {
        const projectOverride = yield* projectOverridesRepository.get({
          extensionId: extensionPackage.id,
          scope: extensionPackage.scope,
          projectPath,
        })
        return projectOverrideToView(projectPath, projectOverride)
      }),
    )
  })
}

export function listExtensionPackagesView(input: ExtensionListPackagesInput) {
  return Effect.gen(function* () {
    const projectPaths = normalizeProjectPaths(input.projectPaths)
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const packages = yield* loadViewPackages(projectPaths)
    const summaries = yield* Effect.forEach(packages, (extensionPackage) =>
      Effect.gen(function* () {
        const lifecycle = yield* lifecycleRepository.get({
          extensionId: extensionPackage.id,
          scope: extensionPackage.scope,
        })
        const projectOverrides = yield* loadProjectOverrides(extensionPackage, projectPaths)
        const projectOverride = getPrimaryProjectOverride(extensionPackage, projectOverrides)
        return packageToSummary(extensionPackage, lifecycle, projectOverride, projectOverrides)
      }),
    )

    return {
      projectPath: projectPaths[0] ?? null,
      projectPaths,
      packages: summaries,
    } satisfies ExtensionManagerView
  })
}
