import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import {
  type ExtensionRightPanelSurfaceId,
  extensionRightPanelSurfaceId,
} from '@shared/types/right-panel-surface-id'

export interface ExtensionSidePanelSurfaceEntry {
  /** Stable Right panel surface id, independent of package path and content hash. */
  readonly surfaceId: ExtensionRightPanelSurfaceId
  readonly entry: ExtensionContributionRegistryEntry
  /** True when the panel can be shown right now (enabled, trusted, compatible, loadable). */
  readonly openable: boolean
  /** Enabled and loadable here, but waiting for trust or an update before it can run. */
  readonly cannotRunYet: boolean
}

function extensionContributionIsEligible(entry: ExtensionContributionRegistryEntry) {
  const eligibility = entry.eligibility
  return (
    eligibility.runtimeEnabled &&
    eligibility.enabled &&
    eligibility.trusted &&
    eligibility.sdkCompatible !== false &&
    !eligibility.updateAvailable &&
    eligibility.disabledProjectPaths.length === 0
  )
}

function isExtensionSidePanelEntry(entry: ExtensionContributionRegistryEntry) {
  return entry.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS
}

function isLoadableExtensionSidePanelEntry(entry: ExtensionContributionRegistryEntry) {
  return (
    isExtensionSidePanelEntry(entry) &&
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE &&
    entry.execution !== undefined &&
    entry.entryPath !== undefined
  )
}

/** A side panel that can be mounted now: federated, with an entry point and eligible to run. */
function isOpenableExtensionSidePanelEntry(entry: ExtensionContributionRegistryEntry) {
  return isLoadableExtensionSidePanelEntry(entry) && extensionContributionIsEligible(entry)
}

/** The Panel rail lists these disabled with what they need (ADR 0043). */
function cannotRunYet(entry: ExtensionContributionRegistryEntry) {
  const { eligibility } = entry
  return (
    isLoadableExtensionSidePanelEntry(entry) &&
    entry.appliesToAllRequestedProjects &&
    eligibility.runtimeEnabled &&
    eligibility.enabled &&
    eligibility.disabledProjectPaths.length === 0 &&
    (!eligibility.trusted || eligibility.sdkCompatible === false || eligibility.updateAvailable)
  )
}

/**
 * One entry per extension side panel surface. The registry may list the same panel from several
 * packages or scopes; an openable entry wins over one that cannot run, otherwise the first wins.
 */
export function extensionSidePanelSurfaces(
  registry: ExtensionContributionRegistryView | null,
): readonly ExtensionSidePanelSurfaceEntry[] {
  if (registry === null) return []
  const surfaces = new Map<ExtensionRightPanelSurfaceId, ExtensionSidePanelSurfaceEntry>()
  for (const entry of registry.entries) {
    if (!isExtensionSidePanelEntry(entry)) continue
    const surfaceId = extensionRightPanelSurfaceId({
      extensionId: entry.extensionId,
      sidePanelId: entry.contributionId,
    })
    const openable = isOpenableExtensionSidePanelEntry(entry)
    const existing = surfaces.get(surfaceId)
    if (existing === undefined || (!existing.openable && openable)) {
      surfaces.set(surfaceId, { surfaceId, entry, openable, cannotRunYet: cannotRunYet(entry) })
    }
  }
  return [...surfaces.values()]
}

/** Surface ids of the extension side panels that can be shown right now. */
export function openableExtensionSidePanelSurfaceIds(
  registry: ExtensionContributionRegistryView | null,
): ReadonlySet<ExtensionRightPanelSurfaceId> {
  return new Set(
    extensionSidePanelSurfaces(registry)
      .filter((surface) => surface.openable)
      .map((surface) => surface.surfaceId),
  )
}
