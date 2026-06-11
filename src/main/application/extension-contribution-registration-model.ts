import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributions } from '@shared/schemas/extensions'
import type { ExtensionContributionFamily } from '@shared/types/extensions'
import { formatErrorMessage } from '@shared/utils/node-error'
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

interface ContributionFamilyDescriptor<Contribution> {
  readonly family: ExtensionContributionFamily
  readonly contributions: (
    contributions: ExtensionContributions,
  ) => readonly Contribution[] | undefined
}

interface ContributionRegistrationAttempt {
  readonly registration: ContributionRegistrationEntry | null
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

function contributionRegistrationFailureDiagnostic(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly family: ExtensionContributionFamily
  readonly error: unknown
  readonly index?: number
}): ExtensionDiagnostic {
  const suffix =
    input.index === undefined
      ? `contributions.${input.family}`
      : `contributions.${input.family}.${input.index}`

  return {
    severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
    code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
    message: `Contribution registration failed: ${formatErrorMessage(input.error)}`,
    path: `${input.extensionPackage.manifestPath}#${suffix}`,
  }
}

function listDescriptorContributionsSafely<Contribution>(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly descriptor: ContributionFamilyDescriptor<Contribution>
  readonly contributions: ExtensionContributions
}) {
  try {
    return {
      contributions: input.descriptor.contributions(input.contributions) ?? [],
      diagnostics: [],
    }
  } catch (error) {
    return {
      contributions: [],
      diagnostics: [
        contributionRegistrationFailureDiagnostic({
          extensionPackage: input.extensionPackage,
          family: input.descriptor.family,
          error,
        }),
      ],
    }
  }
}

function registerContributionSafely<
  Contribution extends ManifestCommandContribution | ManifestEntryContribution,
>(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly family: ExtensionContributionFamily
  readonly contribution: Contribution
  readonly index: number
}): ContributionRegistrationAttempt {
  try {
    const authorization = authorizeContributionRegistration({
      extensionPackage: input.extensionPackage,
      family: input.family,
      contribution: input.contribution,
      index: input.index,
    })
    if (authorization._tag === 'rejected') {
      return { registration: null, diagnostics: authorization.diagnostics }
    }

    return {
      registration: { family: input.family, contribution: input.contribution },
      diagnostics: [],
    }
  } catch (error) {
    return {
      registration: null,
      diagnostics: [
        contributionRegistrationFailureDiagnostic({
          extensionPackage: input.extensionPackage,
          family: input.family,
          error,
          index: input.index,
        }),
      ],
    }
  }
}

function registerDescriptorContributions<
  Contribution extends ManifestCommandContribution | ManifestEntryContribution,
>(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly descriptors: readonly ContributionFamilyDescriptor<Contribution>[]
  readonly contributions: ExtensionContributions
  readonly registrations: ContributionRegistrationEntry[]
  readonly diagnostics: ExtensionDiagnostic[]
}) {
  for (const descriptor of input.descriptors) {
    const listed = listDescriptorContributionsSafely({
      extensionPackage: input.extensionPackage,
      descriptor,
      contributions: input.contributions,
    })
    input.diagnostics.push(...listed.diagnostics)

    for (const [index, contribution] of listed.contributions.entries()) {
      const attempt = registerContributionSafely({
        extensionPackage: input.extensionPackage,
        family: descriptor.family,
        contribution,
        index,
      })
      input.diagnostics.push(...attempt.diagnostics)
      if (attempt.registration !== null) {
        input.registrations.push(attempt.registration)
      }
    }
  }
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

  registerDescriptorContributions({
    extensionPackage,
    descriptors: COMMAND_FAMILY_DESCRIPTORS,
    contributions,
    registrations,
    diagnostics,
  })
  registerDescriptorContributions({
    extensionPackage,
    descriptors: ENTRY_FAMILY_DESCRIPTORS,
    contributions,
    registrations,
    diagnostics,
  })

  return { registrations, diagnostics }
}
