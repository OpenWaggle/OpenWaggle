import { create } from 'zustand'

export const DIFF_RIGHT_SIDEBAR_REQUEST = 'diff'
export const SESSION_TREE_RIGHT_SIDEBAR_REQUEST = 'session-tree'

export function extensionRightSidebarRequest(
  extensionId: string,
  sidePanelId: string,
  packagePath?: string,
  contentHash?: string,
) {
  return JSON.stringify([
    'extension-side-panel',
    extensionId,
    sidePanelId,
    packagePath,
    contentHash,
  ])
}

export function workspaceFileRightSidebarRequest(path: string, line: number | null) {
  return JSON.stringify(['file', path, line])
}

type RouteClaim = {
  readonly kind: 'route'
  readonly requestKey: string
  readonly scopeKey?: string | null
}
type WorkspaceClaim = { readonly kind: 'workspace'; readonly ownerKey: string }
/** The claim a closing action panel gives the right side back to (ADR 0038). */
export type RestorableRightSidebarClaim = RouteClaim | WorkspaceClaim | null

export type RightSidebarClaim =
  | RouteClaim
  | WorkspaceClaim
  /** The guided action panel remembers what it replaced so closing it restores that sidebar. */
  | { readonly kind: 'action-panel'; readonly previous: RestorableRightSidebarClaim }
  | null

interface RightSidebarCoordinatorState {
  readonly activeClaim: RightSidebarClaim
  claimActionPanel: () => void
  releaseActionPanel: () => void
  claimRoute: (requestKey: string, scopeKey?: string | null) => void
  claimWorkspace: (ownerKey: string) => void
  releaseRoute: (requestKey?: string, scopeKey?: string | null) => void
  releaseWorkspace: (ownerKey: string) => void
}

function isRouteClaim(
  claim: RestorableRightSidebarClaim,
  requestKey?: string,
  scopeKey?: string | null,
) {
  if (claim?.kind !== 'route') return false
  if (requestKey !== undefined && claim.requestKey !== requestKey) return false
  return scopeKey === undefined || claim.scopeKey === scopeKey
}

export const useRightSidebarCoordinator = create<RightSidebarCoordinatorState>((set, get) => ({
  activeClaim: null,

  claimActionPanel() {
    const activeClaim = get().activeClaim
    if (activeClaim?.kind === 'action-panel') return
    set({ activeClaim: { kind: 'action-panel', previous: activeClaim } })
  },

  releaseActionPanel() {
    const activeClaim = get().activeClaim
    if (activeClaim?.kind !== 'action-panel') return
    set({ activeClaim: activeClaim.previous })
  },

  claimRoute(requestKey, scopeKey) {
    if (requestKey.length === 0) return
    const activeClaim = get().activeClaim
    if (
      activeClaim?.kind === 'route' &&
      activeClaim.requestKey === requestKey &&
      activeClaim.scopeKey === scopeKey
    )
      return
    set({
      activeClaim: { kind: 'route', requestKey, ...(scopeKey === undefined ? {} : { scopeKey }) },
    })
  },

  claimWorkspace(ownerKey) {
    if (ownerKey.length === 0) return
    const activeClaim = get().activeClaim
    if (activeClaim?.kind === 'workspace' && activeClaim.ownerKey === ownerKey) return
    set({ activeClaim: { kind: 'workspace', ownerKey } })
  },

  releaseRoute(requestKey, scopeKey) {
    const activeClaim = get().activeClaim
    // A sidebar closed while the action panel covers it must not be restored later.
    if (activeClaim?.kind === 'action-panel') {
      if (isRouteClaim(activeClaim.previous, requestKey, scopeKey))
        set({ activeClaim: { kind: 'action-panel', previous: null } })
      return
    }
    if (activeClaim?.kind !== 'route') return
    if (requestKey !== undefined && activeClaim.requestKey !== requestKey) return
    if (scopeKey !== undefined && activeClaim.scopeKey !== scopeKey) return
    set({ activeClaim: null })
  },

  releaseWorkspace(ownerKey) {
    const activeClaim = get().activeClaim
    if (activeClaim?.kind === 'action-panel') {
      const previous = activeClaim.previous
      if (previous?.kind === 'workspace' && previous.ownerKey === ownerKey)
        set({ activeClaim: { kind: 'action-panel', previous: null } })
      return
    }
    if (activeClaim?.kind !== 'workspace' || activeClaim.ownerKey !== ownerKey) return
    set({ activeClaim: null })
  },
}))
