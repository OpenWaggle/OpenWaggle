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

function parseRequestTuple(requestKey: string) {
  if (!requestKey.startsWith('[')) return null
  try {
    const parsed: unknown = JSON.parse(requestKey)
    const result: unknown[] | null = Array.isArray(parsed) ? parsed : null
    return result
  } catch {
    return null
  }
}

function routeSurface(requestKey: string) {
  if (requestKey === 'diff') {
    return { shown: 'changes', highlight: 'changes' } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  if (requestKey === 'change-request') {
    return { shown: null, highlight: 'changes' } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  if (requestKey === 'session-tree') {
    return { shown: 'session-tree', highlight: 'session-tree' } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  if (requestKey === 'hive') {
    return { shown: 'hive', highlight: 'hive' } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  if (requestKey === 'resources') {
    return { shown: 'resources', highlight: 'resources' } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  const tuple = parseRequestTuple(requestKey)
  if (tuple?.[0] === 'file') {
    return { shown: 'files', highlight: 'files' } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  if (
    tuple?.[0] === 'extension-side-panel' &&
    typeof tuple[EXTENSION_ID_INDEX] === 'string' &&
    typeof tuple[SIDE_PANEL_ID_INDEX] === 'string'
  ) {
    const id = extensionRightPanelSurfaceId({
      extensionId: tuple[EXTENSION_ID_INDEX],
      sidePanelId: tuple[SIDE_PANEL_ID_INDEX],
    })
    return { shown: id, highlight: id } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  return { shown: null, highlight: null } satisfies Pick<
    RightPanelShownSurface,
    'shown' | 'highlight'
  >
}

function workspaceSurface(surface: WorkspacePanelSurface) {
  if (surface === null || surface.kind === 'terminal') {
    return { shown: null, highlight: null } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  if (surface.kind === 'browser') {
    return { shown: 'browser', highlight: 'browser' } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  if (surface.kind === 'action') {
    return { shown: null, highlight: 'project-actions' } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  if (surface.kind === 'project-actions') {
    return { shown: 'project-actions', highlight: 'project-actions' } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  if (surface.kind === 'scheduled-tasks') {
    return { shown: 'scheduled-tasks', highlight: 'scheduled-tasks' } satisfies Pick<
      RightPanelShownSurface,
      'shown' | 'highlight'
    >
  }
  return { shown: 'all-panels', highlight: 'all-panels' } satisfies Pick<
    RightPanelShownSurface,
    'shown' | 'highlight'
  >
}

export function resolveShownSurface(input: {
  readonly claim: RightSidebarClaim
  readonly ownerKey: string
  readonly workspaceSurface: WorkspacePanelSurface
  readonly workspacePanelOpen: boolean
}) {
  const { claim } = input
  if (claim === null) return CLOSED
  if (claim.kind === 'action-panel') {
    const surface: RightPanelShownSurface = {
      open: true,
      shown: null,
      highlight: 'project-actions',
      kind: 'action-panel',
    }
    return surface
  }
  if (claim.kind === 'route') {
    const surface: RightPanelShownSurface = {
      open: true,
      ...routeSurface(claim.requestKey),
      kind: 'route',
    }
    return surface
  }
  if (claim.ownerKey !== input.ownerKey || !input.workspacePanelOpen) return CLOSED
  const surface: RightPanelShownSurface = {
    open: true,
    ...workspaceSurface(input.workspaceSurface),
    kind: 'workspace',
  }
  return surface
}
