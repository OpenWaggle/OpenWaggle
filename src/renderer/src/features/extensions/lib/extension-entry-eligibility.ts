import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'

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

/** Whether a contribution cannot run here: off, untrusted, outdated, or not in every requested project. */
export function isBlockedExtensionEntry(
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
