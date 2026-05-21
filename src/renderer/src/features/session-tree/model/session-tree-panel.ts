import type { SessionNode, SessionTree, SessionTreeFilterMode } from '@shared/types/session'
import type { RefObject } from 'react'
import type { SessionTreeRow } from './session-tree-row'

export interface SessionTreePanelProps {
  readonly onClose: () => void
}

export interface ExpandedNodeIdsOverride {
  readonly sessionId: SessionNode['sessionId']
  readonly nodeIds: readonly SessionNode['id'][]
}

export interface SessionTreePanelState {
  readonly expandedNodeIdsOverride: ExpandedNodeIdsOverride | null
  readonly focusIndex: number
}

export type SessionTreePanelAction =
  | {
      readonly type: 'set-expanded-node-ids-override'
      readonly value: ExpandedNodeIdsOverride
    }
  | {
      readonly type: 'set-focus-index'
      readonly value: number
    }

export interface SessionTreeRowsView {
  readonly activeBranchId: SessionTree['session']['lastActiveBranchId']
  readonly activePathIds: ReadonlySet<string>
  readonly clampedFocusIndex: number
  readonly draftBranch: {
    readonly sessionId: SessionNode['sessionId']
    readonly sourceNodeId: SessionNode['id']
  } | null
  readonly rowExpandedNodeIds: readonly SessionNode['id'][]
  readonly tree: SessionTree
  readonly visibleRows: readonly SessionTreeRow[]
}

export interface SessionTreeRowActions {
  readonly focusIndex: (index: number) => void
  readonly selectNode: (node: SessionNode) => void
  readonly toggleNodeExpanded: (row: SessionTreeRow) => void
}

export interface SessionTreeRowRefs {
  readonly rowRefs: RefObject<Map<string, HTMLButtonElement>>
}

export interface SessionTreePanelFilters {
  readonly filterMode: SessionTreeFilterMode
  readonly searchQuery: string
  readonly onFilterModeChange: (mode: string) => void
  readonly onSearchQueryChange: (query: string) => void
}

export interface SessionTreePanelContent {
  readonly rowActions: SessionTreeRowActions
  readonly rowRefs: SessionTreeRowRefs['rowRefs']
  readonly scrollContainerRef: RefObject<HTMLDivElement | null>
  readonly searchActive: boolean
  readonly showTreeScrollToBottom: boolean
  readonly tree: SessionTree | null
  readonly treeRowsRef: RefObject<HTMLDivElement | null>
  readonly view: SessionTreeRowsView | null
  readonly onScrollToTreeBottom: () => void
  readonly onTreeScroll: () => void
}

export interface SessionTreePanelController {
  readonly content: SessionTreePanelContent
  readonly filters: SessionTreePanelFilters
  readonly header: SessionTreePanelProps
}
