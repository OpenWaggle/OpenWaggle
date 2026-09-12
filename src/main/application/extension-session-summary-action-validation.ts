import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionFamily,
  ExtensionContributionRegistryEntry,
  ExtensionSessionSummaryActionView,
  ExtensionSessionSummaryRowView,
} from '@shared/types/extensions'
import type { DiscoveredExtensionPackage, ExtensionDiagnostic } from '../extensions/types'
import { getManifestFamilyContributions } from './extension-contribution-family-model'
import type { ContributionRegistrationEntry } from './extension-contribution-registration-model'

interface InvalidActionReference {
  readonly action: ExtensionSessionSummaryActionView
  readonly message: string
  readonly row: ExtensionSessionSummaryRowView
}

function registrationMatchesAction(
  registration: ContributionRegistrationEntry,
  action: ExtensionSessionSummaryActionView,
) {
  return (
    registration.family === action.family && registration.contribution.id === action.contributionId
  )
}

function matchingActionEntries(
  entries: readonly ExtensionContributionRegistryEntry[],
  action: ExtensionSessionSummaryActionView,
) {
  return entries.filter(
    (entry) => entry.family === action.family && entry.contributionId === action.contributionId,
  )
}

function actionEntryIsAvailable(
  entry: ExtensionContributionRegistryEntry,
  action: ExtensionSessionSummaryActionView,
) {
  const eligibility = entry.eligibility
  if (
    !eligibility.runtimeEnabled ||
    !eligibility.enabled ||
    !eligibility.trusted ||
    eligibility.sdkCompatible === false ||
    eligibility.updateAvailable
  ) {
    return false
  }
  return (
    action.family !== OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS ||
    (entry.capability !== undefined && entry.method !== undefined)
  )
}

function declaredFamiliesForContributionId(
  extensionPackage: DiscoveredExtensionPackage,
  contributionId: string,
) {
  const contributions = extensionPackage.manifest?.contributions
  if (!contributions) return []

  const families: ExtensionContributionFamily[] = []
  for (const family of OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILIES) {
    if (
      getManifestFamilyContributions(contributions, family)?.some(
        (contribution) => contribution.id === contributionId,
      )
    ) {
      families.push(family)
    }
  }
  return families
}

function registeredFamiliesForContributionId(
  registrations: readonly ContributionRegistrationEntry[],
  contributionId: string,
) {
  return registrations
    .filter((registration) => registration.contribution.id === contributionId)
    .map((registration) => registration.family)
}

function uniqueFamilies(families: readonly ExtensionContributionFamily[]) {
  return [...new Set(families)]
}

function wrongFamilyMessage(input: {
  readonly action: ExtensionSessionSummaryActionView
  readonly declaredFamilies: readonly ExtensionContributionFamily[]
}) {
  return `Session Summary action references ${input.action.family} contribution "${input.action.contributionId}", but that id is declared under ${input.declaredFamilies.join(', ')} in the same extension package.`
}

function invalidActionReference(input: {
  readonly action: ExtensionSessionSummaryActionView
  readonly row: ExtensionSessionSummaryRowView
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly registrations: readonly ContributionRegistrationEntry[]
  readonly entries: readonly ExtensionContributionRegistryEntry[]
}): InvalidActionReference | null {
  const actionEntries = matchingActionEntries(input.entries, input.action)
  if (actionEntries.length > 0) {
    return actionEntries.some((entry) => actionEntryIsAvailable(entry, input.action))
      ? null
      : {
          action: input.action,
          row: input.row,
          message: `Session Summary action references ${input.action.family} contribution "${input.action.contributionId}", which is disabled because it has no available executable binding.`,
        }
  }

  if (
    input.registrations.some((registration) =>
      registrationMatchesAction(registration, input.action),
    )
  ) {
    return {
      action: input.action,
      row: input.row,
      message: `Session Summary action references ${input.action.family} contribution "${input.action.contributionId}", which is unavailable in the requested contribution scope.`,
    }
  }

  const declaredFamilies = declaredFamiliesForContributionId(
    input.extensionPackage,
    input.action.contributionId,
  )
  if (declaredFamilies.includes(input.action.family)) {
    return {
      action: input.action,
      row: input.row,
      message: `Session Summary action references ${input.action.family} contribution "${input.action.contributionId}", which is declared by the same package but unavailable because its contribution registration failed.`,
    }
  }

  const wrongFamilies = uniqueFamilies([
    ...registeredFamiliesForContributionId(input.registrations, input.action.contributionId),
    ...declaredFamilies,
  ])
  if (wrongFamilies.length > 0) {
    return {
      action: input.action,
      row: input.row,
      message: wrongFamilyMessage({ action: input.action, declaredFamilies: wrongFamilies }),
    }
  }

  return {
    action: input.action,
    row: input.row,
    message: `Session Summary action references ${input.action.family} contribution "${input.action.contributionId}", which is not declared by the same package.`,
  }
}

function actionDiagnosticPath(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly section: ExtensionContributionRegistryEntry
  readonly row: ExtensionSessionSummaryRowView
}) {
  const sections = input.extensionPackage.manifest?.contributions?.sessionSummarySections ?? []
  const sectionIndex = sections.findIndex((section) => section.id === input.section.contributionId)
  const rowIndex =
    input.section.sessionSummary?.rows.findIndex((row) => row.id === input.row.id) ?? -1
  if (sectionIndex < 0 || rowIndex < 0) {
    return `${input.extensionPackage.manifestPath}#contributions.sessionSummarySections`
  }
  return `${input.extensionPackage.manifestPath}#contributions.sessionSummarySections.${sectionIndex}.rows.${rowIndex}.action`
}

function actionFailureDiagnostic(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly section: ExtensionContributionRegistryEntry
  readonly reference: InvalidActionReference
}): ExtensionDiagnostic {
  return {
    severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
    code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
    message: `Contribution registration failed: ${input.reference.message}`,
    path: actionDiagnosticPath({
      extensionPackage: input.extensionPackage,
      section: input.section,
      row: input.reference.row,
    }),
  }
}

export function validateSessionSummaryActionEntries(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly registrations: readonly ContributionRegistrationEntry[]
  readonly entries: readonly ExtensionContributionRegistryEntry[]
}) {
  const entries: ExtensionContributionRegistryEntry[] = []
  const diagnostics: ExtensionDiagnostic[] = []

  for (const entry of input.entries) {
    if (
      entry.family !== OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SESSION_SUMMARY_SECTIONS ||
      !entry.sessionSummary
    ) {
      entries.push(entry)
      continue
    }

    const invalidReferences = entry.sessionSummary.rows.flatMap((row) => {
      if (!row.action) return []
      const reference = invalidActionReference({
        action: row.action,
        row,
        extensionPackage: input.extensionPackage,
        registrations: input.registrations,
        entries: input.entries,
      })
      return reference ? [reference] : []
    })
    if (invalidReferences.length === 0) {
      entries.push(entry)
      continue
    }

    diagnostics.push(
      ...invalidReferences.map((reference) =>
        actionFailureDiagnostic({
          extensionPackage: input.extensionPackage,
          section: entry,
          reference,
        }),
      ),
    )
  }

  return { entries, diagnostics }
}
