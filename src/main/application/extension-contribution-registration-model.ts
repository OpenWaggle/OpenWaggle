import type { ExtensionContributionFamily } from '@shared/types/extensions'
import type { DiscoveredExtensionPackage, ExtensionDiagnostic } from '../extensions/types'
import { authorizeContributionRegistration } from './extension-contribution-authorization-model'
import {
  COMMAND_FAMILY_DESCRIPTORS,
  ENTRY_FAMILY_DESCRIPTORS,
  type ManifestCommandContribution,
  type ManifestEntryContribution,
} from './extension-contribution-family-model'

export interface ContributionRegistrationEntry {
  readonly family: ExtensionContributionFamily
  readonly contribution: ManifestCommandContribution | ManifestEntryContribution
}

export interface ContributionRegistrationResult {
  readonly registrations: readonly ContributionRegistrationEntry[]
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

export function packageContributionRegistrations(
  extensionPackage: DiscoveredExtensionPackage,
): ContributionRegistrationResult {
  const contributions = extensionPackage.manifest?.contributions
  if (!contributions) {
    return { registrations: [], diagnostics: [] }
  }

  const registrations: ContributionRegistrationEntry[] = []
  const diagnostics: ExtensionDiagnostic[] = []

  for (const descriptor of COMMAND_FAMILY_DESCRIPTORS) {
    for (const [index, contribution] of (descriptor.contributions(contributions) ?? []).entries()) {
      const authorization = authorizeContributionRegistration({
        extensionPackage,
        family: descriptor.family,
        contribution,
        index,
      })
      if (authorization._tag === 'rejected') {
        diagnostics.push(...authorization.diagnostics)
        continue
      }

      registrations.push({ family: descriptor.family, contribution })
    }
  }

  for (const descriptor of ENTRY_FAMILY_DESCRIPTORS) {
    for (const [index, contribution] of (descriptor.contributions(contributions) ?? []).entries()) {
      const authorization = authorizeContributionRegistration({
        extensionPackage,
        family: descriptor.family,
        contribution,
        index,
      })
      if (authorization._tag === 'rejected') {
        diagnostics.push(...authorization.diagnostics)
        continue
      }

      registrations.push({ family: descriptor.family, contribution })
    }
  }

  return { registrations, diagnostics }
}
