import type { SessionNodeId } from '@shared/types/brand'
import type { SessionNode } from '@shared/types/session'

export interface MoveSessionTreeFocusInput {
  readonly currentIndex: number
  readonly visibleCount: number
  readonly direction: 'next' | 'previous'
}

export interface SessionTreeRow {
  readonly node: SessionNode
  readonly visibleParentId: SessionNodeId | null
  readonly visualDepth: number
  readonly parentVisualDepth: number | null
  readonly gutterDepths: readonly number[]
  readonly hasPreviousSibling: boolean
  readonly hasNextSibling: boolean
  readonly hasDisplayedChildren: boolean
  readonly hasExpandableChildren: boolean
  readonly expandableChildCount: number
}

export interface BuildSessionTreeRowsInput {
  readonly nodes: readonly SessionNode[]
  readonly filteredNodes: readonly SessionNode[]
  readonly expandedNodeIds: readonly SessionNodeId[]
  readonly activePathIds: ReadonlySet<string>
}

export interface SessionTreeRowGeometry {
  readonly gutterWidthPx: number
  readonly rowHeightPx: number
  readonly rowCenterYPx: number
  readonly nodeCenterXPx: number
  readonly parentCenterXPx: number | null
  readonly ancestorLines: readonly SessionTreeVerticalConnector[]
  readonly nodeStemTop: SessionTreeVerticalConnector | null
  readonly nodeStemBottom: SessionTreeVerticalConnector | null
  readonly parentStemBottom: SessionTreeVerticalConnector | null
  readonly branchElbow: SessionTreeBranchElbow | null
}

export interface SessionTreeVerticalConnector {
  readonly xPx: number
  readonly yStartPx: number
  readonly yEndPx: number
}

export interface SessionTreeBranchElbow {
  readonly parentCenterXPx: number
  readonly targetCenterXPx: number
  readonly yStartPx: number
  readonly yMidPx: number
}
