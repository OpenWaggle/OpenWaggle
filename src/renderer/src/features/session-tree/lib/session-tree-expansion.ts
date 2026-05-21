import type { SessionNodeId } from '@shared/types/brand'
import type { SessionNode, SessionTreeUiState } from '@shared/types/session'

export function getDefaultExpandedSessionTreeNodeIds(
  nodes: readonly SessionNode[],
): readonly SessionNodeId[] {
  const parentIds = new Set(nodes.flatMap((node) => (node.parentId ? [String(node.parentId)] : [])))
  return nodes.filter((node) => parentIds.has(String(node.id))).map((node) => node.id)
}

export function resolveExpandedSessionTreeNodeIds(input: {
  readonly nodes: readonly SessionNode[]
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
  readonly filteredNodes: readonly SessionNode[]
  readonly expandedNodeIds: readonly SessionNodeId[]
  readonly searchActive: boolean
}): readonly SessionNodeId[] {
  if (input.searchActive) {
    return getDefaultExpandedSessionTreeNodeIds(input.filteredNodes)
  }

  return input.expandedNodeIds
}
