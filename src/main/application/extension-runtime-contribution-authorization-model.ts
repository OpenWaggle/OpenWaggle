import type {
  ExtensionContributionRegistration,
  ExtensionContributionUnregistration,
  OpenWaggleExtensionManifest,
} from '@shared/schemas/extensions'
import type { ExtensionContributionFamily } from '@shared/types/extensions'
import type { DiscoveredExtensionPackage, ExtensionDiagnostic } from '../extensions/types'
import {
  authorizeContributionRegistration,
  type ContributionRegistrationAuthorization,
  contributionDiagnostic,
  familyDiagnostics,
} from './extension-contribution-authorization-model'
import { getManifestFamilyContributions } from './extension-contribution-family-model'

function findStaticManifestContribution(input: {
  readonly manifest: OpenWaggleExtensionManifest | null
  readonly family: ExtensionContributionFamily
  readonly contributionId: string
}) {
  const contributions = input.manifest?.contributions
  if (!contributions) {
    return null
  }

  return (
    getManifestFamilyContributions(contributions, input.family)?.find(
      (contribution) => contribution.id === input.contributionId,
    ) ?? null
  )
}

function staticContributionReplacementDiagnostics(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly family: ExtensionContributionFamily
  readonly contributionId: string
}): readonly ExtensionDiagnostic[] {
  const staticContribution = findStaticManifestContribution({
    manifest: input.extensionPackage.manifest,
    family: input.family,
    contributionId: input.contributionId,
  })
  if (staticContribution === null) {
    return []
  }

  return [
    contributionDiagnostic({
      extensionPackage: input.extensionPackage,
      family: input.family,
      contributionId: input.contributionId,
      message:
        'Dynamic registration cannot replace a contribution that is statically declared in the extension manifest.',
    }),
  ]
}

function staticContributionUnregistrationDiagnostics(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly family: ExtensionContributionFamily
  readonly contributionId: string
}): readonly ExtensionDiagnostic[] {
  const staticContribution = findStaticManifestContribution({
    manifest: input.extensionPackage.manifest,
    family: input.family,
    contributionId: input.contributionId,
  })
  if (staticContribution === null) {
    return []
  }

  return [
    contributionDiagnostic({
      extensionPackage: input.extensionPackage,
      family: input.family,
      contributionId: input.contributionId,
      message:
        'Dynamic unregistration cannot remove a contribution that is statically declared in the extension manifest.',
    }),
  ]
}

export function authorizeRuntimeContributionRegistration(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly registration: ExtensionContributionRegistration
}): ContributionRegistrationAuthorization {
  const authorization = authorizeContributionRegistration({
    extensionPackage: input.extensionPackage,
    family: input.registration.family,
    contribution: input.registration.contribution,
  })
  const diagnostics = [
    ...(authorization._tag === 'rejected' ? authorization.diagnostics : []),
    ...staticContributionReplacementDiagnostics({
      extensionPackage: input.extensionPackage,
      family: input.registration.family,
      contributionId: input.registration.contribution.id,
    }),
  ]

  return diagnostics.length === 0 ? { _tag: 'authorized' } : { _tag: 'rejected', diagnostics }
}

export function authorizeRuntimeContributionUnregistration(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly unregistration: ExtensionContributionUnregistration
}): ContributionRegistrationAuthorization {
  const diagnostics = [
    ...familyDiagnostics({
      extensionPackage: input.extensionPackage,
      family: input.unregistration.family,
      contributionId: input.unregistration.contributionId,
    }),
    ...staticContributionUnregistrationDiagnostics({
      extensionPackage: input.extensionPackage,
      family: input.unregistration.family,
      contributionId: input.unregistration.contributionId,
    }),
  ]

  return diagnostics.length === 0 ? { _tag: 'authorized' } : { _tag: 'rejected', diagnostics }
}
