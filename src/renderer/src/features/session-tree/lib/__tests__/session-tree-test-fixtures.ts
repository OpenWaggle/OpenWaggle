import { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionNode, SessionTreeUiState } from '@shared/types/session'
import { getVisibleSessionTreeRows, type SessionTreeRow } from '../session-tree-visibility'

export const SESSION_ID = SessionId('session-1')
export const FIRST_ROW_INDEX = 0
export const SECOND_ROW_INDEX = 1
export const THIRD_ROW_INDEX = 2
export const FIFTH_ROW_INDEX = 4
export const ROOT_DOT_X = 14
export const FIRST_BRANCH_DOT_X = 38
export const SECOND_BRANCH_DOT_X = 62
export const ROW_TOP_OVERLAP_Y = -1
export const ROW_CENTER_Y = 20
export const ROW_BOTTOM_OVERLAP_Y = 41

export function node(input: {
  readonly id: string
  readonly parentId?: string | null
  readonly depth: number
  readonly order: number
}): SessionNode {
  return {
    id: SessionNodeId(input.id),
    sessionId: SESSION_ID,
    parentId: input.parentId ? SessionNodeId(input.parentId) : null,
    piEntryType: 'message',
    kind: 'assistant_message',
    timestampMs: input.order,
    createdOrder: input.order,
    pathDepth: input.depth,
    contentJson: '{}',
    metadataJson: '{}',
  }
}

export function treeUiState(input: {
  readonly expandedNodeIds: readonly string[]
  readonly expandedNodeIdsTouched: boolean
}): SessionTreeUiState {
  return {
    sessionId: SESSION_ID,
    expandedNodeIds: input.expandedNodeIds.map(SessionNodeId),
    expandedNodeIdsTouched: input.expandedNodeIdsTouched,
    branchesSidebarCollapsed: false,
    updatedAt: 1,
  }
}

export function rowIds(rows: readonly SessionTreeRow[]) {
  return rows.map((row) => String(row.node.id))
}

export function rowDepths(rows: readonly SessionTreeRow[]) {
  return rows.map((row) => row.visualDepth)
}

export function connectorLineXs(
  lines: readonly { readonly xPx: number; readonly yStartPx: number; readonly yEndPx: number }[],
) {
  return lines.map((line) => line.xPx)
}

export function rowAt(rows: readonly SessionTreeRow[], index: number): SessionTreeRow {
  const row = rows[index]
  if (!row) {
    throw new Error(`Expected session tree row at index ${String(index)}`)
  }
  return row
}

export function nodeAt(nodes: readonly SessionNode[], index: number): SessionNode {
  const sessionNode = nodes[index]
  if (!sessionNode) {
    throw new Error(`Expected session node at index ${String(index)}`)
  }
  return sessionNode
}

export function visibleRows(input: {
  readonly nodes: readonly SessionNode[]
  readonly filteredNodes?: readonly SessionNode[]
  readonly expandedNodeIds?: readonly string[]
  readonly activePathIds?: readonly string[]
}) {
  return getVisibleSessionTreeRows({
    nodes: input.nodes,
    filteredNodes: input.filteredNodes ?? input.nodes,
    expandedNodeIds: (input.expandedNodeIds ?? []).map(SessionNodeId),
    activePathIds: new Set(input.activePathIds ?? []),
  })
}

export const TREE = [
  node({ id: 'root', depth: 0, order: 1 }),
  node({ id: 'child-a', parentId: 'root', depth: 1, order: 2 }),
  node({ id: 'grandchild-a', parentId: 'child-a', depth: 2, order: 3 }),
  node({ id: 'child-b', parentId: 'root', depth: 1, order: 4 }),
  node({ id: 'sibling-root', depth: 0, order: 5 }),
]

export const LINEAR_TREE = [
  node({ id: 'linear-root', depth: 0, order: 1 }),
  node({ id: 'linear-child', parentId: 'linear-root', depth: 1, order: 2 }),
  node({ id: 'linear-grandchild', parentId: 'linear-child', depth: 2, order: 3 }),
]

export const BRANCH_TREE = [
  node({ id: 'branch-root', depth: 0, order: 1 }),
  node({ id: 'off-path', parentId: 'branch-root', depth: 1, order: 2 }),
  node({ id: 'active-path', parentId: 'branch-root', depth: 1, order: 3 }),
  node({ id: 'active-leaf', parentId: 'active-path', depth: 2, order: 4 }),
  node({ id: 'off-leaf', parentId: 'off-path', depth: 2, order: 5 }),
]

export const BRANCH_LEAF_SIBLING_TREE = [
  node({ id: 'branch-root', depth: 0, order: 1 }),
  node({ id: 'first-leaf', parentId: 'branch-root', depth: 1, order: 2 }),
  node({ id: 'second-leaf', parentId: 'branch-root', depth: 1, order: 3 }),
]
