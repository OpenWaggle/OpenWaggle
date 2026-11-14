import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionPackageScopeView,
} from '@shared/types/extensions'
import type { ExtensionPackageScope } from '../extensions/types'
import {
  findManifestCapabilityDeclaration,
  getDeclaredScopes,
} from './extension-contribution-authorization-model'
import {
  isEntryContribution,
  isSessionSummaryContribution,
  type ManifestContribution,
  type ManifestContributionMatches,
  type ManifestEntryContribution,
  type ManifestSessionSummaryContribution,
} from './extension-contribution-family-model'
import type { ContributionEntryInput } from './extension-contribution-registry-types'
import {
  type ContributionTargetResolution,
  resolveContributionTarget,
} from './extension-contribution-target-model'
import { issueExtensionInvocationBinding } from './extension-invocation-binding'

function scopeToView(scope: ExtensionPackageScope) {
  if (scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return {
      kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
      label: 'Global',
    } satisfies ExtensionPackageScopeView
  }

  return {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    label: 'Project',
    projectPath: scope.projectPath,
  } satisfies ExtensionPackageScopeView
}

function matchView(matches: ManifestContributionMatches) {
  return {
    ...(matches.toolNames !== undefined ? { toolNames: matches.toolNames } : {}),
    ...(matches.customMessageNames !== undefined
      ? { customMessageNames: matches.customMessageNames }
      : {}),
    ...(matches.interactionKinds !== undefined
      ? { interactionKinds: matches.interactionKinds }
      : {}),
  }
}

function sessionSummaryRowView(row: ManifestSessionSummaryContribution['rows'][number]) {
  return {
    id: row.id,
    label: row.label,
    ...(row.value !== undefined ? { value: row.value } : {}),
    ...(row.badge !== undefined ? { badge: row.badge } : {}),
    ...(row.count !== undefined ? { count: row.count } : {}),
    ...(row.resourceId !== undefined ? { resourceId: row.resourceId } : {}),
    ...(row.action !== undefined ? { action: row.action } : {}),
  }
}

function sessionSummaryDisclosureView(
  disclosure: NonNullable<ManifestSessionSummaryContribution['disclosure']>,
) {
  return {
    ...(disclosure.defaultExpanded !== undefined
      ? { defaultExpanded: disclosure.defaultExpanded }
      : {}),
    ...(disclosure.collapsible !== undefined ? { collapsible: disclosure.collapsible } : {}),
    ...(disclosure.autoCollapseAfterMs !== undefined
      ? { autoCollapseAfterMs: disclosure.autoCollapseAfterMs }
      : {}),
  }
}

function sessionSummaryStateView(state: NonNullable<ManifestSessionSummaryContribution['state']>) {
  if (state.status === 'ready' || state.status === 'failure') return state
  const { message, ...live } = state
  return message === undefined ? live : { ...live, message }
}

function entryContributionMetadata(contribution: ManifestEntryContribution) {
  return {
    runtime: contribution.runtime,
    execution: contribution.execution,
    entryPath: contribution.entry,
    ...(contribution.matches !== undefined ? { matches: matchView(contribution.matches) } : {}),
  }
}

function declaredScopesForContribution(input: {
  readonly extensionPackage: ContributionEntryInput['extensionPackage']
  readonly contribution: ManifestContribution
}) {
  if (isSessionSummaryContribution(input.contribution)) return undefined
  if (input.contribution.capability === undefined) return undefined

  const declaration = findManifestCapabilityDeclaration({
    manifest: input.extensionPackage.manifest,
    capability: input.contribution.capability,
  })

  return declaration ? [...getDeclaredScopes(declaration)] : undefined
}

function brokerBindingsForContribution(input: ContributionEntryInput) {
  const { contribution } = input
  if (isSessionSummaryContribution(contribution)) return {}
  const declaredScopes = declaredScopesForContribution(input)
  return {
    ...(contribution.capability !== undefined ? { capability: contribution.capability } : {}),
    ...(contribution.method !== undefined ? { method: contribution.method } : {}),
    ...(contribution.methods !== undefined ? { methods: contribution.methods } : {}),
    ...(declaredScopes !== undefined ? { declaredScopes } : {}),
  }
}

function isEmptyReadySessionSummary(contribution: ManifestContribution) {
  return (
    isSessionSummaryContribution(contribution) &&
    contribution.rows.length === 0 &&
    (contribution.state === undefined || contribution.state.status === 'ready')
  )
}

function contributionBaseEntry(
  input: ContributionEntryInput,
  targetResolution: ContributionTargetResolution,
) {
  const { contribution, eligibility, extensionPackage } = input
  const manifest = extensionPackage.manifest

  const entry = {
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
  return { ...entry, invocationBinding: issueExtensionInvocationBinding(entry) }
}

function sessionSummaryEntry(
  baseEntry: ReturnType<typeof contributionBaseEntry>,
  contribution: ManifestSessionSummaryContribution,
) {
  return {
    ...baseEntry,
    sessionSummary: {
      placement: contribution.placement ?? 'details',
      ...(contribution.disclosure !== undefined
        ? { disclosure: sessionSummaryDisclosureView(contribution.disclosure) }
        : {}),
      ...(contribution.state !== undefined
        ? { state: sessionSummaryStateView(contribution.state) }
        : {}),
      rows: contribution.rows.map(sessionSummaryRowView),
    },
  } satisfies ExtensionContributionRegistryEntry
}

export function contributionToEntry(input: ContributionEntryInput) {
  const { contribution, eligibility } = input
  if (isEmptyReadySessionSummary(contribution)) return null

  const targetResolution = resolveContributionTarget({
    target: contribution.target,
    eligibilityProjectPaths: eligibility.projectPaths,
    requestedProjectPaths: input.requestedProjectPaths,
    requestedSessionId: input.requestedSessionId,
  })
  if (targetResolution === null) return null

  const baseEntry = contributionBaseEntry(input, targetResolution)
  if (isSessionSummaryContribution(contribution)) {
    return sessionSummaryEntry(baseEntry, contribution)
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
