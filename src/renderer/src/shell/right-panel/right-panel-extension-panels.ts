import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionIconView,
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import {
  type ExtensionRightPanelSurfaceId,
  extensionRightPanelSurfaceId,
} from '@/shared/lib/right-panel-surfaces'

/** What an extension side panel needs before it can run here (ADR 0043). */
export type RailExtensionPanelStatus =
  | { readonly kind: 'available' }
  | { readonly kind: 'needs'; readonly label: string; readonly reason: string }

export interface RailExtensionPanel {
  readonly id: ExtensionRightPanelSurfaceId
  readonly extensionId: string
  readonly extensionName: string
  readonly sidePanelId: string
  readonly title: string
  readonly packagePath: string
  readonly contentHash: string
  readonly icon?: ExtensionContributionIconView
  readonly status: RailExtensionPanelStatus
}

type EntryVisibility = 'hidden' | RailExtensionPanelStatus

/** Only a federated module with an entry point can be mounted in the Right panel. */
function isLoadable(entry: ExtensionContributionRegistryEntry) {
  return (
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE &&
    entry.execution !== undefined &&
    entry.entryPath !== undefined
  )
}

function appliesHere(entry: ExtensionContributionRegistryEntry, requested: readonly string[]) {
  const disabled = new Set(entry.eligibility.disabledProjectPaths)
  if (requested.some((projectPath) => disabled.has(projectPath))) return false
  const available = new Set(entry.projectPaths)
  return requested.every((projectPath) => available.has(projectPath))
}

/**
 * Turned-off or not-applicable panels are hidden; panels that only need trust or an update are
 * listed in All panels, disabled with what they need. Keeping trust as one label among others
 * lets it disappear later without changing the rail.
 */
function entryVisibility(
  entry: ExtensionContributionRegistryEntry,
  requested: readonly string[],
): EntryVisibility {
  const { eligibility } = entry
  if (!eligibility.runtimeEnabled || !eligibility.enabled) return 'hidden'
  if (!isLoadable(entry)) return 'hidden'
  if (!appliesHere(entry, requested)) return 'hidden'
  if (!eligibility.trusted) {
    return {
      kind: 'needs',
      label: 'Needs trust',
      reason: `Trust ${entry.extensionName} in Settings › Extensions to use this panel.`,
    }
  }
  if (eligibility.sdkCompatible === false || eligibility.updateAvailable) {
    return {
      kind: 'needs',
      label: 'Needs update',
      reason: `Update ${entry.extensionName} in Settings › Extensions to use this panel.`,
    }
  }
  return { kind: 'available' }
}

function statusRank(status: RailExtensionPanelStatus) {
  return status.kind === 'available' ? 0 : 1
}

/**
 * Every installed side panel's surface id, including panels hidden here (turned off or not for
 * this project), so a first reorder keeps their install-order slot (ADR 0043).
 */
export function installedExtensionPanelIds(
  registry: ExtensionContributionRegistryView | null,
): ExtensionRightPanelSurfaceId[] {
  if (registry === null) return []
  const ids = registry.entries
    .filter((entry) => entry.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS)
    .map((entry) =>
      extensionRightPanelSurfaceId({
        extensionId: entry.extensionId,
        sidePanelId: entry.contributionId,
      }),
    )
  return [...new Set(ids)]
}

/** Every listable extension side panel, one per stable surface id, in registry (install) order. */
export function railExtensionPanels(
  registry: ExtensionContributionRegistryView | null,
  requestedProjectPaths: readonly string[],
): RailExtensionPanel[] {
  if (registry === null) return []
  const panels = new Map<ExtensionRightPanelSurfaceId, RailExtensionPanel>()
  for (const entry of registry.entries) {
    if (entry.family !== OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS) continue
    const visibility = entryVisibility(entry, requestedProjectPaths)
    if (visibility === 'hidden') continue
    const id = extensionRightPanelSurfaceId({
      extensionId: entry.extensionId,
      sidePanelId: entry.contributionId,
    })
    const existing = panels.get(id)
    if (existing !== undefined && statusRank(existing.status) <= statusRank(visibility)) continue
    panels.set(id, {
      id,
      extensionId: entry.extensionId,
      extensionName: entry.extensionName,
      sidePanelId: entry.contributionId,
      title: entry.title,
      packagePath: entry.packagePath,
      contentHash: entry.contentHash,
      ...(entry.icon ? { icon: entry.icon } : {}),
      status: visibility,
    })
  }
  return [...panels.values()]
}
