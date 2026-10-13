import { SessionId } from '@shared/types/brand'
import type { ExtensionContributionIconView } from '@shared/types/extensions'
import type { SessionLineageSummary } from '@shared/types/session'
import { useInfiniteQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { useChat } from '@/features/chat/hooks'
import { useExtensionSidePanelContributions } from '@/features/extensions'
import { useGit } from '@/features/git/hooks'
import { useHasActiveProjectActionRun } from '@/features/project-actions'
import { useProject, useSessionProjectPath, useSessions } from '@/features/sessions/hooks'
import { rightPanelSurfaceShortcut } from '@/features/settings'
import { usePreferencesStore } from '@/features/settings/state'
import { terminalOwnerContext } from '@/features/terminal'
import { hiveStateNeedsAttention } from '@/queries/session-hive-contract'
import { hiveTreeMembers, sessionHiveTreeQueryOptions } from '@/queries/session-hive-tree'
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
const NEEDS_A_HIVE = 'Only for Sessions in a Hive'

/** The active Session's lineage, read from the chat store's summary list. */
function activeSessionLineage(
  sessions: readonly { readonly id: unknown; readonly lineage?: SessionLineageSummary | null }[],
  activeSessionId: unknown,
) {
  return sessions.find((session) => String(session.id) === String(activeSessionId))?.lineage
}

/** True for a live Queen or Worker Session; legacy task-runner ancestry is not a Hive. */
function lineageInHive(
  lineage: { readonly role: string; readonly historical?: boolean } | null | undefined,
) {
  return (
    lineage !== undefined &&
    lineage !== null &&
    lineage.role !== 'independent' &&
    lineage.historical !== true
  )
}

/**
 * Whether any live Worker of the active Session's Hive needs the user (ADR 0050).
 *
 * Only queried while the Session is in a Hive, so an ordinary chat adds no reads.
 */
function useHiveAttention(sessionId: string | null, enabled: boolean) {
  const query = useInfiniteQuery({
    ...sessionHiveTreeQueryOptions(SessionId(sessionId ?? '')),
    enabled: enabled && sessionId !== null,
  })
  if (!enabled) return false
  return hiveTreeMembers(query.data?.pages).some(
    (member) =>
      member.archived !== true && hiveStateNeedsAttention(member.lineage?.delegationState),
  )
}

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
  /** A Worker in this Hive needs the user; the rail shows it as a Hive attention dot (ADR 0050). */
  readonly attention: boolean
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
    /** The open Session's own project, which Project Actions follow (not the preference). */
    readonly sessionProjectPath: string | null
    readonly sessionId: string | null
    readonly hasSessionTree: boolean
    readonly sessionInHive: boolean
  },
) {
  if (id === 'project-actions') return context.sessionProjectPath ? null : NEEDS_PROJECT
  if (id === 'all-panels') return context.ownerKey.length > 0 ? null : NEEDS_PROJECT
  if (id === 'session-tree') return context.hasSessionTree ? null : NEEDS_FIRST_MESSAGE
  if (id === 'resources') return context.sessionId ? null : NEEDS_FIRST_MESSAGE
  if (id === 'hive') return context.sessionInHive ? null : NEEDS_A_HIVE
  if (id === 'browser') return context.ownerKey.length > 0 ? null : NEEDS_PROJECT
  return context.projectPath ? null : NEEDS_PROJECT
}

/** The Right panel's surfaces, rail and current state for the active chat context (ADR 0043). */
export function useRightPanelModel(enabled = true): RightPanelModel {
  const { activeSession, activeSessionId: chatActiveSessionId, sessions: chatSessions } = useChat()
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
  const sessionProjectPath = useSessionProjectPath()
  const running = useHasActiveProjectActionRun(sessionProjectPath, sessionId)
  const sessionInHive = lineageInHive(activeSessionLineage(chatSessions, chatActiveSessionId))
  const hiveAttention = useHiveAttention(sessionId, sessionInHive)
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
    sessionProjectPath,
    sessionId,
    hasSessionTree: Boolean(activeSessionTree),
    sessionInHive,
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
    attention: surface.id === 'hive' && hiveAttention,
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
    attention: false,
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
