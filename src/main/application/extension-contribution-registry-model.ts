import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributions } from '@shared/schemas/extensions'
import type {
  ExtensionContributionEligibilityView,
  ExtensionContributionFamily,
  ExtensionContributionRegistryEntry,
  ExtensionContributionUiLane,
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
  ExtensionProjectOverrideState,
} from '../extensions/types'

interface ManifestCommandContribution {
  readonly id: string
  readonly title: string
  readonly category?: string
  readonly capability?: string
}

interface ManifestEntryContribution {
  readonly id: string
  readonly title: string
  readonly lane: ExtensionContributionUiLane
  readonly entry: string
}

export interface ExtensionContributionProjectOverrideLookup {
  readonly projectPath: string
  readonly projectOverride: ExtensionProjectOverrideState | null
}

interface ContributionPackageEligibility {
  readonly projectPaths: readonly string[]
  readonly eligibility: ExtensionContributionEligibilityView
  readonly diagnostics: readonly ExtensionDiagnosticView[]
}

interface ContributionEntryInput {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly eligibility: ContributionPackageEligibility
  readonly requestedProjectPaths: readonly string[]
  readonly family: ExtensionContributionFamily
  readonly contribution: ManifestCommandContribution | ManifestEntryContribution
}

interface CommandFamilyDescriptor {
  readonly family: 'commands' | 'slashCommands'
  readonly contributions: (
    contributions: ExtensionContributions,
  ) => readonly ManifestCommandContribution[] | undefined
}

interface EntryFamilyDescriptor {
  readonly family: Exclude<ExtensionContributionFamily, CommandFamilyDescriptor['family']>
  readonly contributions: (
    contributions: ExtensionContributions,
  ) => readonly ManifestEntryContribution[] | undefined
}

const COMMAND_FAMILY_DESCRIPTORS = [
  { family: 'commands', contributions: (contributions) => contributions.commands },
  { family: 'slashCommands', contributions: (contributions) => contributions.slashCommands },
] satisfies readonly CommandFamilyDescriptor[]

const ENTRY_FAMILY_DESCRIPTORS = [
  { family: 'routes', contributions: (contributions) => contributions.routes },
  {
    family: 'settingsSections',
    contributions: (contributions) => contributions.settingsSections,
  },
  { family: 'sidePanels', contributions: (contributions) => contributions.sidePanels },
  { family: 'dialogs', contributions: (contributions) => contributions.dialogs },
  {
    family: 'transcriptRenderers',
    contributions: (contributions) => contributions.transcriptRenderers,
  },
  { family: 'statusWidgets', contributions: (contributions) => contributions.statusWidgets },
] satisfies readonly EntryFamilyDescriptor[]

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
  if (!enabled) {
    return null
  }

  const trusted = input.lifecycle
    ? isExtensionCurrentTrustPin({
        extensionPackage: input.extensionPackage,
        lifecycle: input.lifecycle,
      })
    : false

  return {
    projectPaths: enabledProjectPaths,
    diagnostics: diagnosticsToView([
      ...input.extensionPackage.diagnostics,
      ...(input.lifecycle?.diagnostics ?? []),
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

function isEntryContribution(
  contribution: ManifestCommandContribution | ManifestEntryContribution,
): contribution is ManifestEntryContribution {
  return 'entry' in contribution
}

function contributionToEntry(input: ContributionEntryInput): ExtensionContributionRegistryEntry {
  const { contribution, eligibility, extensionPackage } = input
  const manifest = extensionPackage.manifest
  const baseEntry = {
    extensionId: extensionPackage.id,
    extensionName: manifest?.name ?? extensionPackage.id,
    extensionVersion: manifest?.version ?? '',
    scope: scopeToView(extensionPackage.scope),
    packagePath: extensionPackage.packagePath,
    manifestPath: extensionPackage.manifestPath,
    projectPaths: eligibility.projectPaths,
    appliesToAllRequestedProjects:
      eligibility.projectPaths.length === input.requestedProjectPaths.length,
    family: input.family,
    contributionId: contribution.id,
    title: contribution.title,
    label: contribution.title,
    eligibility: eligibility.eligibility,
    diagnostics: eligibility.diagnostics,
  }

  if (isEntryContribution(contribution)) {
    return { ...baseEntry, lane: contribution.lane, entryPath: contribution.entry }
  }

  return {
    ...baseEntry,
    ...(contribution.category !== undefined ? { category: contribution.category } : {}),
    ...(contribution.capability !== undefined ? { capability: contribution.capability } : {}),
  }
}

function contributionsToEntries(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly eligibility: ContributionPackageEligibility
  readonly requestedProjectPaths: readonly string[]
  readonly contributions: ExtensionContributions
}) {
  const entries: ExtensionContributionRegistryEntry[] = []

  for (const descriptor of COMMAND_FAMILY_DESCRIPTORS) {
    for (const contribution of descriptor.contributions(input.contributions) ?? []) {
      entries.push(contributionToEntry({ ...input, family: descriptor.family, contribution }))
    }
  }

  for (const descriptor of ENTRY_FAMILY_DESCRIPTORS) {
    for (const contribution of descriptor.contributions(input.contributions) ?? []) {
      entries.push(contributionToEntry({ ...input, family: descriptor.family, contribution }))
    }
  }

  return entries
}

export function packageToContributionEntries(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly projectOverrides: readonly ExtensionContributionProjectOverrideLookup[]
  readonly requestedProjectPaths: readonly string[]
}) {
  const contributions = input.extensionPackage.manifest?.contributions
  if (!contributions) {
    return []
  }

  const eligibility = buildPackageEligibility(input)
  if (!eligibility) {
    return []
  }

  return contributionsToEntries({
    extensionPackage: input.extensionPackage,
    eligibility,
    requestedProjectPaths: input.requestedProjectPaths,
    contributions,
  })
}
