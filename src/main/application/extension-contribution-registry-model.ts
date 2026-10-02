import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionDiagnosticView,
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
} from '../extensions/types'
import { isEntryContribution } from './extension-contribution-family-model'
import {
  type ContributionRegistrationEntry,
  type ContributionRegistrationResult,
  packageContributionRegistrations,
} from './extension-contribution-registration-model'
import { contributionToEntry } from './extension-contribution-registry-entry-model'
import type {
  ContributionIconDeclaration,
  ContributionPackageEligibility,
  ContributionRegistryBuildResult,
  ExtensionContributionProjectOverrideLookup,
} from './extension-contribution-registry-types'
import { validateSessionSummaryActionEntries } from './extension-session-summary-action-validation'

export type { ExtensionContributionProjectOverrideLookup } from './extension-contribution-registry-types'

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

function declaredPanelIcon(registration: ContributionRegistrationEntry) {
  if (registration.family !== OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS) return undefined
  return isEntryContribution(registration.contribution) ? registration.contribution.icon : undefined
}

function contributionRegistrationsToEntries(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly eligibility: ContributionPackageEligibility
  readonly requestedProjectPaths: readonly string[]
  readonly requestedSessionId: string | undefined
  readonly registrations: readonly ContributionRegistrationEntry[]
}) {
  const entries: ExtensionContributionRegistryEntry[] = []
  const iconDeclarations: ContributionIconDeclaration[] = []

  for (const registration of input.registrations) {
    const entry = contributionToEntry({
      ...input,
      family: registration.family,
      contribution: registration.contribution,
    })
    if (entry === null) continue
    entries.push(entry)
    const icon = declaredPanelIcon(registration)
    if (icon !== undefined) iconDeclarations.push({ entry, icon })
  }

  return { entries, iconDeclarations }
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
    return {
      entries: [],
      diagnostics: [],
      iconDeclarations: [],
    } satisfies ContributionRegistryBuildResult
  }

  const eligibility = buildPackageEligibility(input)
  if (!eligibility) {
    return {
      entries: [],
      diagnostics: [],
      iconDeclarations: [],
    } satisfies ContributionRegistryBuildResult
  }

  const registrationResult = input.getRegistrationResult(input.extensionPackage)
  const built = contributionRegistrationsToEntries({
    extensionPackage: input.extensionPackage,
    eligibility,
    requestedProjectPaths: input.requestedProjectPaths,
    requestedSessionId: input.requestedSessionId,
    registrations: registrationResult.registrations,
  })
  const validated = validateSessionSummaryActionEntries({
    extensionPackage: input.extensionPackage,
    registrations: registrationResult.registrations,
    entries: built.entries,
  })

  const validatedEntries = new Set(validated.entries)
  return {
    entries: validated.entries,
    diagnostics: [...registrationResult.diagnostics, ...validated.diagnostics],
    iconDeclarations: built.iconDeclarations.filter((declaration) =>
      validatedEntries.has(declaration.entry),
    ),
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
