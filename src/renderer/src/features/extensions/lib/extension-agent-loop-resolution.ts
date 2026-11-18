import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionFamily,
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionContributionRuntime,
  ExtensionExecutionPlacement,
} from '@shared/types/extensions'
import { isBlockedExtensionEntry } from './extension-entry-eligibility'

export type ExtensionAgentLoopSurfaceKind =
  | 'tool'
  | 'custom-message'
  | 'interaction'
  | 'status'
  | 'transcript'

export interface ExtensionAgentLoopTarget {
  readonly surface: ExtensionAgentLoopSurfaceKind
  readonly extensionId?: string
  readonly contributionId?: string
  readonly toolName?: string
  readonly customMessageName?: string
  readonly interactionKind?: string
}

export interface ResolvedExtensionAgentLoopContribution {
  readonly entry: ExtensionContributionRegistryEntry
  readonly runtime: ExtensionContributionRuntime
  readonly execution: ExtensionExecutionPlacement
  readonly entryPath: string
}

export type ExtensionAgentLoopResolution =
  | {
      readonly status: 'available'
      readonly contribution: ResolvedExtensionAgentLoopContribution
    }
  | {
      readonly status: 'not-found'
      readonly title: string
      readonly message: string
    }
  | {
      readonly status: 'blocked'
      readonly title: string
      readonly message: string
    }
  | {
      readonly status: 'invalid'
      readonly title: string
      readonly message: string
    }

const SURFACE_FAMILY = {
  tool: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
  'custom-message': OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.CUSTOM_MESSAGE_RENDERERS,
  interaction: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.INTERACTION_RENDERERS,
  status: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.STATUS_WIDGETS,
  transcript: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS,
} satisfies Record<ExtensionAgentLoopSurfaceKind, ExtensionContributionFamily>

function normalized(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function includesDeclaredMatch(
  values: readonly string[] | undefined,
  requested: string | undefined,
) {
  return (
    values !== undefined &&
    values.length > 0 &&
    requested !== undefined &&
    values.includes(requested)
  )
}

export function extensionAgentLoopEntryMatchesTarget(
  entry: ExtensionContributionRegistryEntry,
  target: ExtensionAgentLoopTarget,
) {
  const extensionId = normalized(target.extensionId)
  if (extensionId !== undefined && entry.extensionId !== extensionId) {
    return false
  }

  const contributionId = normalized(target.contributionId)
  if (contributionId !== undefined && entry.contributionId !== contributionId) {
    return false
  }

  if (
    target.surface === 'tool' &&
    !includesDeclaredMatch(entry.matches?.toolNames, normalized(target.toolName))
  ) {
    return false
  }

  if (
    target.surface === 'custom-message' &&
    !includesDeclaredMatch(entry.matches?.customMessageNames, normalized(target.customMessageName))
  ) {
    return false
  }

  if (
    target.surface === 'interaction' &&
    !includesDeclaredMatch(entry.matches?.interactionKinds, normalized(target.interactionKind))
  ) {
    return false
  }

  return true
}

function candidateEntries(
  registry: ExtensionContributionRegistryView,
  target: ExtensionAgentLoopTarget,
) {
  const family = SURFACE_FAMILY[target.surface]
  return registry.entries.filter(
    (entry) => entry.family === family && extensionAgentLoopEntryMatchesTarget(entry, target),
  )
}

function resolvedContributionFromEntry(entry: ExtensionContributionRegistryEntry) {
  if (!entry.runtime || !entry.execution || !entry.entryPath) {
    return null
  }

  return {
    entry,
    runtime: entry.runtime,
    execution: entry.execution,
    entryPath: entry.entryPath,
  }
}

function notFoundResolution() {
  return {
    status: 'not-found',
    title: 'Extension renderer not available',
    message: 'No registered extension renderer matches this agent-loop surface.',
  } satisfies ExtensionAgentLoopResolution
}

function blockedResolution() {
  return {
    status: 'blocked',
    title: 'Extension renderer blocked',
    message:
      'This renderer is disabled, untrusted, SDK-incompatible, pending update approval, or outside the active project scope.',
  } satisfies ExtensionAgentLoopResolution
}

function invalidResolution() {
  return {
    status: 'invalid',
    title: 'Extension renderer incomplete',
    message:
      'The renderer contribution is missing its runtime, execution placement, or entry path.',
  } satisfies ExtensionAgentLoopResolution
}

export function resolveExtensionAgentLoopContribution({
  registry,
  target,
  requestedProjectPaths,
}: {
  readonly registry: ExtensionContributionRegistryView
  readonly target: ExtensionAgentLoopTarget
  readonly requestedProjectPaths: readonly string[]
}) {
  const candidates = candidateEntries(registry, target)
  let firstBlocked: ExtensionAgentLoopResolution | null = null
  let firstInvalid: ExtensionAgentLoopResolution | null = null

  for (const entry of candidates) {
    if (isBlockedExtensionEntry(entry, requestedProjectPaths)) {
      firstBlocked ??= blockedResolution()
      continue
    }

    const contribution = resolvedContributionFromEntry(entry)
    if (contribution === null) {
      firstInvalid ??= invalidResolution()
      continue
    }

    return {
      status: 'available',
      contribution,
    } satisfies ExtensionAgentLoopResolution
  }

  return (firstInvalid ??
    firstBlocked ??
    notFoundResolution()) satisfies ExtensionAgentLoopResolution
}

export function resolveExtensionAgentLoopContributionEntries({
  registry,
  target,
  requestedProjectPaths,
  family,
}: {
  readonly registry: ExtensionContributionRegistryView
  readonly target: ExtensionAgentLoopTarget
  readonly requestedProjectPaths: readonly string[]
  readonly family: ExtensionContributionFamily
}) {
  const contributions: ResolvedExtensionAgentLoopContribution[] = []

  for (const entry of registry.entries) {
    if (entry.family !== family || !extensionAgentLoopEntryMatchesTarget(entry, target)) {
      continue
    }

    if (isBlockedExtensionEntry(entry, requestedProjectPaths)) {
      continue
    }

    const contribution = resolvedContributionFromEntry(entry)
    if (contribution !== null) {
      contributions.push(contribution)
    }
  }

  return contributions
}
