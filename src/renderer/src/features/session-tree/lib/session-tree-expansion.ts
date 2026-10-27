import type { SessionNodeId } from '@shared/types/brand'
import type { SessionTreeNode, SessionTreeUiState } from '@shared/types/session'

export function getDefaultExpandedSessionTreeNodeIds(
  nodes: readonly SessionTreeNode[],
): readonly SessionNodeId[] {
  const parentIds = new Set(nodes.flatMap((node) => (node.parentId ? [String(node.parentId)] : [])))
  return nodes.flatMap((node) => (parentIds.has(String(node.id)) ? [node.id] : []))
}

export function resolveExpandedSessionTreeNodeIds(input: {
  readonly nodes: readonly SessionTreeNode[]
  readonly uiState: SessionTreeUiState | null
  readonly overrideNodeIds: readonly SessionNodeId[] | null
}): readonly SessionNodeId[] {
  if (input.overrideNodeIds) {
    return input.overrideNodeIds
  }

  if (input.uiState?.expandedNodeIdsTouched) {
    return input.uiState.expandedNodeIds
  }

  return getDefaultExpandedSessionTreeNodeIds(input.nodes)
}

export function resolveSessionTreeRowExpandedNodeIds(input: {
  /** Every node of the tree, including the ones the filter and search leave out. */
  readonly nodes: readonly SessionTreeNode[]
  readonly filteredNodes: readonly SessionTreeNode[]
  readonly expandedNodeIds: readonly SessionNodeId[]
  readonly searchActive: boolean
}): readonly SessionNodeId[] {
  if (input.searchActive) {
    /*
     * A match stays hidden while any ancestor is collapsed, including one the filter leaves out,
     * such as the model and thinking-level entries every Session starts with. Expanding only the
     * parents among the results hid every match under them, so a search expands every parent.
     */
    return getDefaultExpandedSessionTreeNodeIds(input.nodes)
  }

  return input.expandedNodeIds
}
