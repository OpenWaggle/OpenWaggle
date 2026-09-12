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

export type RightSidebarClaim =
  | { readonly kind: 'route'; readonly requestKey: string }
  | { readonly kind: 'workspace'; readonly ownerKey: string }
  | null

interface RightSidebarCoordinatorState {
  readonly activeClaim: RightSidebarClaim
  claimRoute: (requestKey: string) => void
  claimWorkspace: (ownerKey: string) => void
  releaseRoute: (requestKey?: string) => void
  releaseWorkspace: (ownerKey: string) => void
}

export const useRightSidebarCoordinator = create<RightSidebarCoordinatorState>((set, get) => ({
  activeClaim: null,

  claimRoute(requestKey) {
    if (requestKey.length === 0) return
    const activeClaim = get().activeClaim
    if (activeClaim?.kind === 'route' && activeClaim.requestKey === requestKey) return
    set({ activeClaim: { kind: 'route', requestKey } })
  },

  claimWorkspace(ownerKey) {
    if (ownerKey.length === 0) return
    const activeClaim = get().activeClaim
    if (activeClaim?.kind === 'workspace' && activeClaim.ownerKey === ownerKey) return
    set({ activeClaim: { kind: 'workspace', ownerKey } })
  },

  releaseRoute(requestKey) {
    const activeClaim = get().activeClaim
    if (activeClaim?.kind !== 'route') return
    if (requestKey !== undefined && activeClaim.requestKey !== requestKey) return
    set({ activeClaim: null })
  },

  releaseWorkspace(ownerKey) {
    const activeClaim = get().activeClaim
    if (activeClaim?.kind !== 'workspace' || activeClaim.ownerKey !== ownerKey) return
    set({ activeClaim: null })
  },
}))
