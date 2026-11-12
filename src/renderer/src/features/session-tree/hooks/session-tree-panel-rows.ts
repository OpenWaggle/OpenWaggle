import type { SessionNodeId } from '@shared/types/brand'
import type { SessionTree, SessionTreeFilterMode, SessionTreeNode } from '@shared/types/session'
import { buildPiTranscriptPath } from '@shared/utils/session-entry-paths'
import { filterSessionTreeNodes, searchSessionTreeNodes } from '../lib/session-tree-filter'
import {
  clampSessionTreeFocusIndex,
  getVisibleSessionTreeRows,
  resolveExpandedSessionTreeNodeIds,
  resolveSessionTreeRowExpandedNodeIds,
} from '../lib/session-tree-visibility'
import type { ExpandedNodeIdsOverride } from '../model'

const EMPTY_SESSION_NODES: readonly SessionTreeNode[] = []

interface BuildSessionTreePanelRowsInput {
  readonly tree: SessionTree | null
  /** The node the workspace shows; its path from the root is highlighted. */
  readonly activeNodeId: SessionNodeId | null | undefined
  /** Node ids whose full text the Host matched for `searchQuery` (`sessions:search-tree`). */
  readonly textMatchNodeIds?: ReadonlySet<string>
  readonly filterMode: SessionTreeFilterMode
  readonly searchQuery: string
  readonly focusIndex: number
  readonly expandedNodeIdsOverride: ExpandedNodeIdsOverride | null
}

function treeNodes(tree: SessionTree | null) {
  return tree?.nodes ?? EMPTY_SESSION_NODES
}

function expandedNodeIdsOverrideForTree(input: BuildSessionTreePanelRowsInput) {
  if (!input.tree) {
    return null
  }
  if (input.expandedNodeIdsOverride?.sessionId !== input.tree.session.id) {
    return null
  }
  return input.expandedNodeIdsOverride.nodeIds
}

function filterNodes(tree: SessionTree | null, filterMode: SessionTreeFilterMode) {
  if (!tree) {
    return EMPTY_SESSION_NODES
  }
  return filterSessionTreeNodes(tree.nodes, filterMode)
}

function searchNodes(input: {
  readonly tree: SessionTree | null
  readonly filteredNodes: readonly SessionTreeNode[]
  readonly query: string
  readonly textMatchNodeIds: ReadonlySet<string> | undefined
}) {
  if (!input.tree) {
    return EMPTY_SESSION_NODES
  }
  return searchSessionTreeNodes({
    nodes: input.tree.nodes,
    filteredNodes: input.filteredNodes,
    query: input.query,
    ...(input.textMatchNodeIds ? { textMatchNodeIds: input.textMatchNodeIds } : {}),
  })
}

/**
 * The active node's path from the root, from the tree's own structure: the workspace now holds
 * only the newest window of the transcript path (ADR 0036, B5), not all of it.
 */
function activePathNodeIds(
  tree: SessionTree | null,
  activeNodeId: SessionNodeId | null | undefined,
) {
  if (!tree || !activeNodeId) return new Set<string>()
  const path = buildPiTranscriptPath(String(activeNodeId), tree.nodes, {
    getId: (node) => String(node.id),
    getParentId: (node) => (node.parentId ? String(node.parentId) : null),
  })
  return new Set(path.map((node) => String(node.id)))
}

export function buildSessionTreePanelRows(input: BuildSessionTreePanelRowsInput) {
  const activePathIds = activePathNodeIds(input.tree, input.activeNodeId)
  const nodes = treeNodes(input.tree)
  const expandedNodeIds = resolveExpandedSessionTreeNodeIds({
    nodes,
    uiState: input.tree?.uiState ?? null,
    overrideNodeIds: expandedNodeIdsOverrideForTree(input),
  })
  const modeFilteredNodes = filterNodes(input.tree, input.filterMode)
  const filteredNodes = searchNodes({
    tree: input.tree,
    filteredNodes: modeFilteredNodes,
    query: input.searchQuery,
    textMatchNodeIds: input.textMatchNodeIds,
  })
  const searchActive = input.searchQuery.trim().length > 0
  const rowExpandedNodeIds = resolveSessionTreeRowExpandedNodeIds({
    nodes,
    filteredNodes,
    expandedNodeIds,
    searchActive,
  })
  const visibleRows = getVisibleSessionTreeRows({
    nodes,
    filteredNodes,
    expandedNodeIds: rowExpandedNodeIds,
    activePathIds,
  })

  return {
    activePathIds,
    clampedFocusIndex: clampSessionTreeFocusIndex(input.focusIndex, visibleRows.length),
    expandedNodeIds,
    rowExpandedNodeIds,
    searchActive,
    visibleNodes: visibleRows.map((row) => row.node),
    visibleRows,
  }
}
