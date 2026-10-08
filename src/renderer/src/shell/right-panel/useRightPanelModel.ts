import type { ExtensionContributionIconView } from '@shared/types/extensions'
import type { LucideIcon } from 'lucide-react'
import { useChat } from '@/features/chat/hooks'
import { useExtensionSidePanelContributions } from '@/features/extensions'
import { useGit } from '@/features/git/hooks'
import { useActionProjectPath, useHasActiveProjectActionRun } from '@/features/project-actions'
import { useProject, useSessions } from '@/features/sessions/hooks'
import { rightPanelSurfaceShortcut } from '@/features/settings'
import { usePreferencesStore } from '@/features/settings/state'
import { terminalOwnerContext } from '@/features/terminal'
import { BUILT_IN_RIGHT_PANEL_SURFACES } from '@/shared/lib/right-panel-catalog'
import type { RightPanelSurfaceId } from '@/shared/lib/right-panel-surfaces'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { useWorkspacePanelStore } from '../workspace-panel-store'
import {
  installedExtensionPanelIds,
  type RailExtensionPanel,
  railExtensionPanels,
} from './right-panel-extension-panels'
import { visibleRailOrder } from './right-panel-rail-order'
import { useRightPanelRailStore } from './right-panel-rail-store'
import { type RightPanelShownSurface, resolveShownSurface } from './right-panel-shown-surface'

const NEEDS_PROJECT = 'Open a project first'
const NEEDS_FIRST_MESSAGE = 'Available after the first message'

export type RightPanelSurfaceGlyph =
  | { readonly kind: 'lucide'; readonly icon: LucideIcon }
  | { readonly kind: 'extension'; readonly icon?: ExtensionContributionIconView }

/** One entry in the Panel rail, All panels and the command palette. */
export interface RightPanelSurfaceEntry {
  readonly id: RightPanelSurfaceId
  readonly title: string
  readonly description: string
  readonly glyph: RightPanelSurfaceGlyph
  readonly group: 'Workspace' | 'Session' | 'Extensions' | null
  readonly shortcutLabel: string | null
  /** Why the surface cannot open here; null when it can. */
  readonly disabledReason: string | null
  /** Short marker shown beside an extension panel that cannot run yet. */
  readonly needsLabel: string | null
  readonly extension: RailExtensionPanel | null
  readonly pinned: boolean
  readonly isNew: boolean
  readonly running: boolean
}

export interface RightPanelModel {
  readonly ownerKey: string
  readonly sessionKey: string | null
  readonly projectPath: string | null
  readonly shown: RightPanelShownSurface
  /** Every surface: built-ins in catalog order, then extension panels in install order. */
  readonly surfaces: readonly RightPanelSurfaceEntry[]
  /** Surfaces on the rail right now, in the user's order (All panels excluded). */
  readonly railSurfaces: readonly RightPanelSurfaceEntry[]
  /** Every surface id the rail may show in this context. */
  readonly knownRailIds: readonly RightPanelSurfaceId[]
  /** Every surface with a rail slot, including those that cannot run or are hidden here. */
  readonly listedRailIds: readonly RightPanelSurfaceId[]
  /** The extension registry answered or failed; either way there is nothing more to wait for. */
  readonly extensionRegistrySettled: boolean
  readonly extensionPanels: readonly RailExtensionPanel[]
  readonly extensionRegistryLoaded: boolean
}

function builtInDisabledReason(
  id: RightPanelSurfaceId,
  context: {
    readonly ownerKey: string
    readonly projectPath: string | null
    readonly sessionId: string | null
    readonly hasSessionTree: boolean
  },
) {
  if (id === 'all-panels') return context.ownerKey.length > 0 ? null : NEEDS_PROJECT
  if (id === 'session-tree') return context.hasSessionTree ? null : NEEDS_FIRST_MESSAGE
  if (id === 'resources') return context.sessionId ? null : NEEDS_FIRST_MESSAGE
  if (id === 'browser') return context.ownerKey.length > 0 ? null : NEEDS_PROJECT
  return context.projectPath ? null : NEEDS_PROJECT
}

/** The Right panel's surfaces, rail and current state for the active chat context (ADR 0043). */
export function useRightPanelModel(enabled = true): RightPanelModel {
  const { activeSession } = useChat()
  const { projectPath } = useProject()
  const { activeSessionTree } = useSessions()
  const git = useGit()
  const workingPath = git.workingPath ?? projectPath ?? null
  const sessionId = activeSession ? String(activeSession.id) : null
  const owner = terminalOwnerContext(activeSession ?? null, projectPath ?? null)
  const claim = useRightSidebarCoordinator((state) => state.activeClaim)
  const group = useWorkspacePanelStore((state) => state.groups[owner.ownerKey])
  const shortcutBindings = usePreferencesStore((state) => state.settings.shortcutBindings)
  const extensionPanelShortcutBindings = usePreferencesStore(
    (state) => state.settings.extensionPanelShortcutBindings,
  )
  const shortcutLabel = (id: RightPanelSurfaceId) =>
    rightPanelSurfaceShortcut({ shortcutBindings, extensionPanelShortcutBindings }, id).label
  const railOrder = useRightPanelRailStore((state) => state.order)
  const hidden = useRightPanelRailStore((state) => state.hidden)
  const acknowledged = useRightPanelRailStore((state) => state.acknowledged)
  const extensionsInitialized = useRightPanelRailStore((state) => state.extensionsInitialized)
  const running = useHasActiveProjectActionRun(useActionProjectPath(), sessionId)
  const sidePanels = useExtensionSidePanelContributions({
    enabled,
    projectPath: workingPath,
    sessionId,
  })
  const extensionPanels = railExtensionPanels(sidePanels.registry, sidePanels.projectPaths)
  const shown = resolveShownSurface({
    claim,
    ownerKey: owner.ownerKey,
    workspaceSurface: group?.activeSurface ?? null,
    workspacePanelOpen: group?.panelOpen === true,
  })
  const context = {
    ownerKey: owner.ownerKey,
    projectPath: projectPath ?? null,
    sessionId,
    hasSessionTree: Boolean(activeSessionTree),
  }

  const hiddenIds = new Set(hidden)
  const acknowledgedIds = new Set(acknowledged)
  const builtIns: RightPanelSurfaceEntry[] = BUILT_IN_RIGHT_PANEL_SURFACES.map((surface) => ({
    id: surface.id,
    title: surface.title,
    description: surface.description,
    glyph: { kind: 'lucide', icon: surface.icon },
    group: surface.group,
    shortcutLabel: shortcutLabel(surface.id),
    disabledReason: builtInDisabledReason(surface.id, context),
    needsLabel: null,
    extension: null,
    pinned: surface.id === 'all-panels' || !hiddenIds.has(surface.id),
    isNew: false,
    running: surface.id === 'project-actions' && running,
  }))
  const extensions: RightPanelSurfaceEntry[] = extensionPanels.map((panel) => ({
    id: panel.id,
    title: panel.title,
    description: panel.extensionName,
    glyph: { kind: 'extension', ...(panel.icon ? { icon: panel.icon } : {}) },
    group: 'Extensions',
    shortcutLabel: shortcutLabel(panel.id),
    disabledReason: panel.status.kind === 'available' ? null : panel.status.reason,
    needsLabel: panel.status.kind === 'available' ? null : panel.status.label,
    extension: panel,
    pinned: !hiddenIds.has(panel.id),
    isNew: extensionsInitialized && !acknowledgedIds.has(panel.id),
    running: false,
  }))
  const surfaces = [...builtIns, ...extensions]
  const listed = surfaces.filter((surface) => surface.id !== 'all-panels')
  const knownRailIds = listed
    .filter((surface) => surface.needsLabel === null)
    .map((surface) => surface.id)
  // Built-ins, then every installed extension panel in install order, hidden here or not.
  const listedRailIds = [
    ...new Set([
      ...builtIns.filter((surface) => surface.id !== 'all-panels').map((surface) => surface.id),
      ...installedExtensionPanelIds(sidePanels.registry),
      ...listed.map((surface) => surface.id),
    ]),
  ]
  const order = visibleRailOrder(railOrder, knownRailIds, hidden)
  const railSurfaces = order.flatMap((id) => surfaces.find((surface) => surface.id === id) ?? [])

  return {
    ownerKey: owner.ownerKey,
    sessionKey: owner.ownerKey.length > 0 ? owner.ownerKey : null,
    projectPath: projectPath ?? null,
    shown,
    surfaces,
    railSurfaces,
    knownRailIds,
    listedRailIds,
    extensionPanels,
    extensionRegistryLoaded: sidePanels.registry !== null,
    extensionRegistrySettled: sidePanels.registry !== null || !sidePanels.loading,
  }
}
