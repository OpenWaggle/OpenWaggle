import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributions } from '@shared/schemas/extensions'
import type {
  ExtensionBuildPlanView,
  ExtensionDiagnosticView,
  ExtensionLifecycleView,
  ExtensionManifestSummary,
  ExtensionPackageScopeView,
  ExtensionPackageSummary,
  ExtensionProjectOverrideView,
  ExtensionSdkCompatibilityView,
} from '@shared/types/extensions'
import {
  isExtensionBuildPlanApproved,
  isExtensionCurrentTrustPin,
  isExtensionRuntimeEnabled,
  isExtensionUpdateAvailable,
} from '../extensions/runtime-eligibility'
import type {
  DiscoveredExtensionPackage,
  ExtensionDiagnostic,
  ExtensionLifecycleState,
  ExtensionPackageScope,
  ExtensionProjectOverrideState,
} from '../extensions/types'

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
    contributionCount(contributions.toolRenderers) +
    contributionCount(contributions.customMessageRenderers) +
    contributionCount(contributions.interactionRenderers) +
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

function buildPlanToView(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState | null,
): ExtensionBuildPlanView | null {
  const buildPlan = extensionPackage.buildPlan
  if (!buildPlan) {
    return null
  }

  return {
    installSource: buildPlan.installSource,
    command: buildPlan.command,
    outputCount: buildPlan.outputPaths.length,
    approvalRequired: buildPlan.approvalRequired,
    approved: isExtensionBuildPlanApproved({ extensionPackage, lifecycle }),
    inputHash: buildPlan.inputHash,
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
    updateAvailable: isExtensionUpdateAvailable({ extensionPackage, lifecycle: state }),
    grantedCapabilities: enabled ? state.grantedCapabilities : [],
    contentHash: state.contentHash,
    packageVersion: state.packageVersion,
    approvedBuildPlanHash: state.approvedBuildPlanHash,
    buildStatus: state.buildStatus,
    buildLog: state.buildLog,
    reloadStatus: state.reloadStatus,
    lastReloadedAt: state.lastReloadedAt,
    sdkRange: state.sdkRange,
    sdkCompatible: state.sdkCompatible,
    diagnostics: diagnosticsToView(state.diagnostics),
    installedAt: state.installedAt,
    updatedAt: state.updatedAt,
  }
}

export function projectOverrideToView(
  projectPath: string,
  projectOverride: ExtensionProjectOverrideState | null,
): ExtensionProjectOverrideView {
  return {
    projectPath,
    disabled: projectOverride?.disabled ?? false,
    updatedAt: projectOverride?.updatedAt ?? null,
  }
}

export function unavailableProjectOverrideToView(
  projectPath: string,
): ExtensionProjectOverrideView {
  return {
    projectPath,
    disabled: true,
    updatedAt: null,
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

export function packageToSummary(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly projectOverride: ExtensionProjectOverrideView | null
  readonly projectOverrides: readonly ExtensionProjectOverrideView[]
}): ExtensionPackageSummary {
  return {
    id: input.extensionPackage.id,
    scope: scopeToView(input.extensionPackage.scope),
    packagePath: input.extensionPackage.packagePath,
    manifestPath: input.extensionPackage.manifestPath,
    manifest: input.extensionPackage.manifest
      ? manifestToSummary(input.extensionPackage.manifest)
      : null,
    buildPlan: buildPlanToView(input.extensionPackage, input.lifecycle),
    contentHash: input.extensionPackage.contentHash,
    sdkCompatibility: sdkCompatibilityToView(input.extensionPackage.sdkCompatibility),
    lifecycle: input.lifecycle
      ? lifecycleToView(input.lifecycle, input.extensionPackage, input.projectOverride)
      : null,
    projectOverride: input.projectOverride,
    projectOverrides: input.projectOverrides,
    diagnostics: diagnosticsToView(input.extensionPackage.diagnostics),
  }
}
