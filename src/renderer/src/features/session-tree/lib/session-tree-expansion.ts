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
  readonly filteredNodes: readonly SessionTreeNode[]
  readonly expandedNodeIds: readonly SessionNodeId[]
  readonly searchActive: boolean
}): readonly SessionNodeId[] {
  if (input.searchActive) {
    return getDefaultExpandedSessionTreeNodeIds(input.filteredNodes)
  }

  return input.expandedNodeIds
}
