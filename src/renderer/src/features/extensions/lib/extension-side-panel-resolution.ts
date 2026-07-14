import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionContributionRuntime,
  ExtensionExecutionPlacement,
} from '@shared/types/extensions'

export interface ExtensionSidePanelTarget {
  readonly extensionId: string
  readonly sidePanelId: string
  readonly packagePath?: string
  readonly contentHash?: string
}

export interface ResolvedExtensionSidePanelContribution {
  readonly entry: ExtensionContributionRegistryEntry
  readonly runtime: ExtensionContributionRuntime
  readonly execution: ExtensionExecutionPlacement
  readonly entryPath: string
}

export type ExtensionSidePanelResolution =
  | {
      readonly status: 'available'
      readonly contribution: ResolvedExtensionSidePanelContribution
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

const SIDE_PANEL_FAMILY = OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS

function normalizeSidePanelId(sidePanelId: string) {
  return sidePanelId.trim()
}

function sidePanelEntriesForTarget(
  registry: ExtensionContributionRegistryView,
  target: {
    readonly extensionId: string
    readonly packagePath?: string
    readonly contentHash?: string
  },
) {
  return registry.entries.filter(
    (entry) =>
      entry.family === SIDE_PANEL_FAMILY &&
      entry.extensionId === target.extensionId &&
      (target.packagePath === undefined || entry.packagePath === target.packagePath) &&
      (target.contentHash === undefined || entry.contentHash === target.contentHash),
  )
}

function disabledForRequestedProject(
  entry: ExtensionContributionRegistryEntry,
  requestedProjectPaths: readonly string[],
) {
  const disabledProjectPaths = new Set(entry.eligibility.disabledProjectPaths)
  return requestedProjectPaths.some((projectPath) => disabledProjectPaths.has(projectPath))
}

function missingRequestedProject(
  entry: ExtensionContributionRegistryEntry,
  requestedProjectPaths: readonly string[],
) {
  const availableProjectPaths = new Set(entry.projectPaths)
  return requestedProjectPaths.some((projectPath) => !availableProjectPaths.has(projectPath))
}

function isBlockedSidePanelEntry(
  entry: ExtensionContributionRegistryEntry,
  requestedProjectPaths: readonly string[],
) {
  return (
    !entry.eligibility.runtimeEnabled ||
    !entry.eligibility.enabled ||
    !entry.eligibility.trusted ||
    entry.eligibility.sdkCompatible === false ||
    entry.eligibility.updateAvailable ||
    disabledForRequestedProject(entry, requestedProjectPaths) ||
    missingRequestedProject(entry, requestedProjectPaths)
  )
}

export function resolveExtensionSidePanelContribution({
  registry,
  target,
  requestedProjectPaths,
}: {
  readonly registry: ExtensionContributionRegistryView
  readonly target: ExtensionSidePanelTarget
  readonly requestedProjectPaths: readonly string[]
}): ExtensionSidePanelResolution {
  const extensionId = target.extensionId.trim()
  const sidePanelId = normalizeSidePanelId(target.sidePanelId)
  const packagePath = target.packagePath?.trim()
  const contentHash = target.contentHash?.trim()

  if (extensionId.length === 0 || sidePanelId.length === 0) {
    return {
      status: 'invalid',
      title: 'Invalid extension side panel',
      message:
        'Extension side panel URLs must include both an extension id and a side panel contribution id.',
    }
  }

  const extensionSidePanelEntries = sidePanelEntriesForTarget(registry, {
    extensionId,
    ...(packagePath ? { packagePath } : {}),
    ...(contentHash ? { contentHash } : {}),
  })
  if (extensionSidePanelEntries.length === 0) {
    return {
      status: 'not-found',
      title: 'Extension side panel not available',
      message:
        'No registered side panel contributions match this extension in the active extension registry.',
    }
  }

  const entry = extensionSidePanelEntries.find(
    (candidate) => candidate.contributionId === sidePanelId,
  )
  if (!entry) {
    return {
      status: 'not-found',
      title: 'Side panel contribution not available',
      message:
        'The requested side panel id is not registered for this extension in the active extension registry.',
    }
  }

  if (isBlockedSidePanelEntry(entry, requestedProjectPaths)) {
    return {
      status: 'blocked',
      title: 'Extension side panel blocked',
      message:
        'This side panel is disabled, untrusted, SDK-incompatible, pending update approval, or outside the active project scope.',
    }
  }

  if (!entry.runtime || !entry.execution || !entry.entryPath) {
    return {
      status: 'invalid',
      title: 'Side panel contribution incomplete',
      message:
        'The side panel contribution is missing its renderer runtime, execution placement, or entry path.',
    }
  }

  return {
    status: 'available',
    contribution: {
      entry,
      runtime: entry.runtime,
      execution: entry.execution,
      entryPath: entry.entryPath,
    },
  }
}
