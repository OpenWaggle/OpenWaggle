import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionEligibilityView,
  ExtensionContributionFamily,
  ExtensionContributionRegistryEntry,
  ExtensionDiagnosticView,
  ExtensionPackageScopeView,
} from '@shared/types/extensions'
import {
  isExtensionCurrentTrustPin,
  isExtensionRuntimeEnabled,
  isExtensionUpdateAvailable,
} from '../extensions/runtime-eligibility'
import type {
  DiscoveredExtensionPackage,
  ExtensionDiagnostic,
  ExtensionLifecycleState,
  ExtensionPackageScope,
} from '../extensions/types'
import {
  findManifestCapabilityDeclaration,
  getDeclaredScopes,
} from './extension-contribution-authorization-model'
import {
  isEntryContribution,
  type ManifestCommandContribution,
  type ManifestEntryContribution,
} from './extension-contribution-family-model'
import {
  type ContributionRegistrationEntry,
  type ContributionRegistrationResult,
  packageContributionRegistrations,
} from './extension-contribution-registration-model'
import { resolveContributionTarget } from './extension-contribution-target-model'

export interface ExtensionContributionProjectOverrideLookup {
  readonly projectPath: string
  readonly projectOverride: { readonly disabled: boolean } | null
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

interface ContributionPackageEligibility {
  readonly contentHash: string
  readonly projectPaths: readonly string[]
  readonly eligibility: ExtensionContributionEligibilityView
  readonly diagnostics: readonly ExtensionDiagnosticView[]
}

interface ContributionEntryInput {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly eligibility: ContributionPackageEligibility
  readonly requestedProjectPaths: readonly string[]
  readonly requestedSessionId: string | undefined
  readonly family: ExtensionContributionFamily
  readonly contribution: ManifestCommandContribution | ManifestEntryContribution
}

interface ContributionRegistryBuildResult {
  readonly entries: readonly ExtensionContributionRegistryEntry[]
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

function scopeToView(scope: ExtensionPackageScope): ExtensionPackageScopeView {
  if (scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' }
  }

  return {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    label: 'Project',
    projectPath: scope.projectPath,
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

function getEnabledProjectPaths(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly projectOverrides: readonly ExtensionContributionProjectOverrideLookup[]
}) {
  const enabledProjectPaths: string[] = []
  const disabledProjectPaths: string[] = []

  if (input.projectOverrides.length === 0) {
    const enabled = isExtensionRuntimeEnabled({
      extensionPackage: input.extensionPackage,
      lifecycle: input.lifecycle,
      projectOverride: null,
    })
    return { enabled, enabledProjectPaths, disabledProjectPaths }
  }

  for (const projectOverrideLookup of input.projectOverrides) {
    if (projectOverrideLookup.projectOverride?.disabled === true) {
      disabledProjectPaths.push(projectOverrideLookup.projectPath)
    }

    if (
      isExtensionRuntimeEnabled({
        extensionPackage: input.extensionPackage,
        lifecycle: input.lifecycle,
        projectOverride: projectOverrideLookup.projectOverride,
      })
    ) {
      enabledProjectPaths.push(projectOverrideLookup.projectPath)
    }
  }

  return { enabled: enabledProjectPaths.length > 0, enabledProjectPaths, disabledProjectPaths }
}

function buildPackageEligibility(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly projectOverrides: readonly ExtensionContributionProjectOverrideLookup[]
}): ContributionPackageEligibility | null {
  const { enabled, enabledProjectPaths, disabledProjectPaths } = getEnabledProjectPaths(input)
  if (!enabled || input.extensionPackage.contentHash === null) {
    return null
  }

  const trusted = input.lifecycle
    ? isExtensionCurrentTrustPin({
        extensionPackage: input.extensionPackage,
        lifecycle: input.lifecycle,
      })
    : false

  return {
    contentHash: input.extensionPackage.contentHash,
    projectPaths: enabledProjectPaths,
    diagnostics: diagnosticsToView([
      ...input.extensionPackage.diagnostics,
      ...(input.lifecycle?.diagnostics ?? []),
      ...input.projectOverrides.flatMap((projectOverride) => projectOverride.diagnostics),
    ]),
    eligibility: {
      runtimeEnabled: true,
      enabled: input.lifecycle?.enabled ?? false,
      trusted,
      sdkCompatible: input.extensionPackage.sdkCompatibility?.compatible ?? null,
      updateAvailable: isExtensionUpdateAvailable({
        extensionPackage: input.extensionPackage,
        lifecycle: input.lifecycle,
      }),
      disabledProjectPaths,
    },
  }
}

function entryContributionMetadata(contribution: ManifestEntryContribution) {
  return {
    runtime: contribution.runtime,
    execution: contribution.execution,
    entryPath: contribution.entry,
    ...(contribution.matches !== undefined ? { matches: contribution.matches } : {}),
  }
}

function declaredScopesForContribution(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly contribution: ManifestCommandContribution | ManifestEntryContribution
}) {
  if (input.contribution.capability === undefined) {
    return undefined
  }

  const declaration = findManifestCapabilityDeclaration({
    manifest: input.extensionPackage.manifest,
    capability: input.contribution.capability,
  })

  return declaration ? [...getDeclaredScopes(declaration)] : undefined
}

function brokerBindingsForContribution(input: ContributionEntryInput) {
  const { contribution } = input
  const declaredScopes = declaredScopesForContribution(input)
  return {
    ...(contribution.capability !== undefined ? { capability: contribution.capability } : {}),
    ...(contribution.method !== undefined ? { method: contribution.method } : {}),
    ...(contribution.methods !== undefined ? { methods: contribution.methods } : {}),
    ...(declaredScopes !== undefined ? { declaredScopes } : {}),
  }
}

function contributionToEntry(
  input: ContributionEntryInput,
): ExtensionContributionRegistryEntry | null {
  const { contribution, eligibility, extensionPackage } = input
  const targetResolution = resolveContributionTarget({
    target: contribution.target,
    eligibilityProjectPaths: eligibility.projectPaths,
    requestedProjectPaths: input.requestedProjectPaths,
    requestedSessionId: input.requestedSessionId,
  })
  if (targetResolution === null) {
    return null
  }

  const manifest = extensionPackage.manifest
  const baseEntry = {
    extensionId: extensionPackage.id,
    extensionName: manifest?.name ?? extensionPackage.id,
    extensionVersion: manifest?.version ?? '',
    scope: scopeToView(extensionPackage.scope),
    packagePath: extensionPackage.packagePath,
    manifestPath: extensionPackage.manifestPath,
    contentHash: eligibility.contentHash,
    projectPaths: targetResolution.projectPaths,
    ...(targetResolution.sessionId !== undefined ? { sessionId: targetResolution.sessionId } : {}),
    appliesToAllRequestedProjects:
      targetResolution.projectPaths.length === input.requestedProjectPaths.length,
    family: input.family,
    contributionId: contribution.id,
    title: contribution.title,
    label: contribution.title,
    ...(targetResolution.target !== undefined ? { target: targetResolution.target } : {}),
    ...(manifest?.network?.origins !== undefined
      ? { networkOrigins: manifest.network.origins }
      : {}),
    eligibility: eligibility.eligibility,
    diagnostics: eligibility.diagnostics,
  }

  const brokerBindings = brokerBindingsForContribution(input)

  if (isEntryContribution(contribution)) {
    return {
      ...baseEntry,
      ...brokerBindings,
      ...entryContributionMetadata(contribution),
    }
  }

  return {
    ...baseEntry,
    ...brokerBindings,
    ...(contribution.category !== undefined ? { category: contribution.category } : {}),
  }
}

function contributionRegistrationsToEntries(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly eligibility: ContributionPackageEligibility
  readonly requestedProjectPaths: readonly string[]
  readonly requestedSessionId: string | undefined
  readonly registrations: readonly ContributionRegistrationEntry[]
}): readonly ExtensionContributionRegistryEntry[] {
  const entries: ExtensionContributionRegistryEntry[] = []

  for (const registration of input.registrations) {
    const entry = contributionToEntry({
      ...input,
      family: registration.family,
      contribution: registration.contribution,
    })
    if (entry !== null) {
      entries.push(entry)
    }
  }

  return entries
}

export function packageToContributionEntriesWithRegistrationResolver(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly projectOverrides: readonly ExtensionContributionProjectOverrideLookup[]
  readonly requestedProjectPaths: readonly string[]
  readonly requestedSessionId: string | undefined
  readonly getRegistrationResult: (
    extensionPackage: DiscoveredExtensionPackage,
  ) => ContributionRegistrationResult
}) {
  const contributions = input.extensionPackage.manifest?.contributions
  if (!contributions) {
    return { entries: [], diagnostics: [] } satisfies ContributionRegistryBuildResult
  }

  const eligibility = buildPackageEligibility(input)
  if (!eligibility) {
    return { entries: [], diagnostics: [] } satisfies ContributionRegistryBuildResult
  }

  const registrationResult = input.getRegistrationResult(input.extensionPackage)

  return {
    entries: contributionRegistrationsToEntries({
      extensionPackage: input.extensionPackage,
      eligibility,
      requestedProjectPaths: input.requestedProjectPaths,
      requestedSessionId: input.requestedSessionId,
      registrations: registrationResult.registrations,
    }),
    diagnostics: registrationResult.diagnostics,
  } satisfies ContributionRegistryBuildResult
}

export function packageToContributionEntries(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly projectOverrides: readonly ExtensionContributionProjectOverrideLookup[]
  readonly requestedProjectPaths: readonly string[]
  readonly requestedSessionId: string | undefined
}) {
  return packageToContributionEntriesWithRegistrationResolver({
    extensionPackage: input.extensionPackage,
    lifecycle: input.lifecycle,
    projectOverrides: input.projectOverrides,
    requestedProjectPaths: input.requestedProjectPaths,
    requestedSessionId: input.requestedSessionId,
    getRegistrationResult: packageContributionRegistrations,
  })
}
