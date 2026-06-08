import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionContributionRuntime,
  ExtensionExecutionPlacement,
} from '@shared/types/extensions'

export interface ExtensionDialogTarget {
  readonly extensionId: string
  readonly dialogId: string
  readonly packagePath: string
  readonly contentHash: string
}

export interface ResolvedExtensionDialogContribution {
  readonly entry: ExtensionContributionRegistryEntry
  readonly runtime: ExtensionContributionRuntime
  readonly execution: ExtensionExecutionPlacement
  readonly entryPath: string
}

export type ExtensionDialogResolution =
  | {
      readonly status: 'available'
      readonly contribution: ResolvedExtensionDialogContribution
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

const DIALOG_FAMILY = OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.DIALOGS

function normalizeDialogId(dialogId: string) {
  return dialogId.trim()
}

function dialogEntriesForTargetPackage(
  registry: ExtensionContributionRegistryView,
  target: {
    readonly extensionId: string
    readonly packagePath: string
    readonly contentHash: string
  },
) {
  return registry.entries.filter(
    (entry) =>
      entry.family === DIALOG_FAMILY &&
      entry.extensionId === target.extensionId &&
      entry.packagePath === target.packagePath &&
      entry.contentHash === target.contentHash,
  )
}

function disabledForRequestedProject(
  entry: ExtensionContributionRegistryEntry,
  requestedProjectPaths: readonly string[],
) {
  return requestedProjectPaths.some((projectPath) =>
    entry.eligibility.disabledProjectPaths.includes(projectPath),
  )
}

function missingRequestedProject(
  entry: ExtensionContributionRegistryEntry,
  requestedProjectPaths: readonly string[],
) {
  return requestedProjectPaths.some((projectPath) => !entry.projectPaths.includes(projectPath))
}

function isBlockedDialogEntry(
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

export function resolveExtensionDialogContribution({
  registry,
  target,
  requestedProjectPaths,
}: {
  readonly registry: ExtensionContributionRegistryView
  readonly target: ExtensionDialogTarget
  readonly requestedProjectPaths: readonly string[]
}): ExtensionDialogResolution {
  const extensionId = target.extensionId.trim()
  const dialogId = normalizeDialogId(target.dialogId)
  const packagePath = target.packagePath
  const contentHash = target.contentHash.trim()

  if (
    extensionId.length === 0 ||
    dialogId.length === 0 ||
    packagePath.length === 0 ||
    contentHash.length === 0
  ) {
    return {
      status: 'invalid',
      title: 'Invalid extension dialog',
      message:
        'Extension dialog requests must include an extension id, dialog contribution id, package path, and content hash.',
    }
  }

  const extensionDialogEntries = dialogEntriesForTargetPackage(registry, {
    extensionId,
    packagePath,
    contentHash,
  })
  if (extensionDialogEntries.length === 0) {
    return {
      status: 'not-found',
      title: 'Extension dialog not available',
      message:
        'No registered dialog contributions match this extension package in the active extension registry.',
    }
  }

  const entry = extensionDialogEntries.find((candidate) => candidate.contributionId === dialogId)
  if (!entry) {
    return {
      status: 'not-found',
      title: 'Dialog contribution not available',
      message:
        'The requested dialog id is not registered for this extension in the active extension registry.',
    }
  }

  if (isBlockedDialogEntry(entry, requestedProjectPaths)) {
    return {
      status: 'blocked',
      title: 'Extension dialog blocked',
      message:
        'This dialog is disabled, untrusted, SDK-incompatible, pending update approval, or outside the active project scope.',
    }
  }

  if (!entry.runtime || !entry.execution || !entry.entryPath) {
    return {
      status: 'invalid',
      title: 'Dialog contribution incomplete',
      message:
        'The dialog contribution is missing its renderer runtime, execution placement, or entry path.',
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
