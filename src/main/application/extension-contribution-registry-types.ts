import type { ExtensionSidePanelIcon } from '@shared/schemas/extensions'
import type {
  ExtensionContributionEligibilityView,
  ExtensionContributionFamily,
  ExtensionContributionRegistryEntry,
  ExtensionDiagnosticView,
} from '@shared/types/extensions'
import type { DiscoveredExtensionPackage, ExtensionDiagnostic } from '../extensions/types'
import type {
  ManifestCommandContribution,
  ManifestEntryContribution,
  ManifestSessionSummaryContribution,
} from './extension-contribution-family-model'

export interface ExtensionContributionProjectOverrideLookup {
  readonly projectPath: string
  readonly projectOverride: { readonly disabled: boolean } | null
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

export interface ContributionPackageEligibility {
  readonly contentHash: string
  readonly projectPaths: readonly string[]
  readonly eligibility: ExtensionContributionEligibilityView
  readonly diagnostics: readonly ExtensionDiagnosticView[]
}

export interface ContributionEntryInput {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly eligibility: ContributionPackageEligibility
  readonly requestedProjectPaths: readonly string[]
  readonly requestedSessionId: string | undefined
  readonly family: ExtensionContributionFamily
  readonly contribution:
    | ManifestCommandContribution
    | ManifestEntryContribution
    | ManifestSessionSummaryContribution
}

/** A side panel entry whose declared Panel rail icon still has to be resolved by the host. */
export interface ContributionIconDeclaration {
  readonly entry: ExtensionContributionRegistryEntry
  readonly icon: ExtensionSidePanelIcon
}

export interface ContributionRegistryBuildResult {
  readonly entries: readonly ExtensionContributionRegistryEntry[]
  readonly diagnostics: readonly ExtensionDiagnostic[]
  readonly iconDeclarations: readonly ContributionIconDeclaration[]
}
