import {
  extensionRightPanelSurfaceId,
  type RightPanelSurfaceId,
} from '@/shared/lib/right-panel-surfaces'
import type { RightSidebarClaim } from '@/shared/lib/right-sidebar-coordinator'
import type { WorkspacePanelSurface } from '../workspace-panel-model'

/**
 * What the Right panel shows: `shown` is the surface whose rail icon toggles it closed, and
 * `highlight` is the rail entry it belongs to. A change request, an action run or the guided
 * action panel highlight their owner without being that surface (ADR 0043).
 */
export interface RightPanelShownSurface {
  readonly open: boolean
  readonly shown: RightPanelSurfaceId | null
  readonly highlight: RightPanelSurfaceId | null
  readonly kind: 'route' | 'workspace' | 'action-panel' | null
}

/** Request tuples are `[kind, extensionId, sidePanelId, ...]` (right-sidebar-coordinator). */
const EXTENSION_ID_INDEX = 1
const SIDE_PANEL_ID_INDEX = 2

const CLOSED: RightPanelShownSurface = { open: false, shown: null, highlight: null, kind: null }

function parseRequestTuple(requestKey: string): unknown[] | null {
  if (!requestKey.startsWith('[')) return null
  try {
    const parsed: unknown = JSON.parse(requestKey)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function routeSurface(requestKey: string): Pick<RightPanelShownSurface, 'shown' | 'highlight'> {
  if (requestKey === 'diff') return { shown: 'changes', highlight: 'changes' }
  if (requestKey === 'change-request') return { shown: null, highlight: 'changes' }
  if (requestKey === 'session-tree') return { shown: 'session-tree', highlight: 'session-tree' }
  if (requestKey === 'resources') return { shown: 'resources', highlight: 'resources' }
  const tuple = parseRequestTuple(requestKey)
  if (tuple?.[0] === 'file') return { shown: 'files', highlight: 'files' }
  if (
    tuple?.[0] === 'extension-side-panel' &&
    typeof tuple[EXTENSION_ID_INDEX] === 'string' &&
    typeof tuple[SIDE_PANEL_ID_INDEX] === 'string'
  ) {
    const id = extensionRightPanelSurfaceId({
      extensionId: tuple[EXTENSION_ID_INDEX],
      sidePanelId: tuple[SIDE_PANEL_ID_INDEX],
    })
    return { shown: id, highlight: id }
  }
  return { shown: null, highlight: null }
}

function workspaceSurface(
  surface: WorkspacePanelSurface,
): Pick<RightPanelShownSurface, 'shown' | 'highlight'> {
  if (surface === null || surface.kind === 'terminal') return { shown: null, highlight: null }
  if (surface.kind === 'browser') return { shown: 'browser', highlight: 'browser' }
  if (surface.kind === 'action') return { shown: null, highlight: 'project-actions' }
  if (surface.kind === 'project-actions') {
    return { shown: 'project-actions', highlight: 'project-actions' }
  }
  return { shown: 'all-panels', highlight: 'all-panels' }
}

export function resolveShownSurface(input: {
  readonly claim: RightSidebarClaim
  readonly ownerKey: string
  readonly workspaceSurface: WorkspacePanelSurface
  readonly workspacePanelOpen: boolean
}): RightPanelShownSurface {
  const { claim } = input
  if (claim === null) return CLOSED
  if (claim.kind === 'action-panel') {
    return { open: true, shown: null, highlight: 'project-actions', kind: 'action-panel' }
  }
  if (claim.kind === 'route') {
    return { open: true, ...routeSurface(claim.requestKey), kind: 'route' }
  }
  if (claim.ownerKey !== input.ownerKey || !input.workspacePanelOpen) return CLOSED
  return { open: true, ...workspaceSurface(input.workspaceSurface), kind: 'workspace' }
}
