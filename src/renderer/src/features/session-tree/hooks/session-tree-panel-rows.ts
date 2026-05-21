import type { SessionNode, SessionTree, SessionTreeFilterMode } from '@shared/types/session'
import { filterSessionTreeNodes, searchSessionTreeNodes } from '../lib/session-tree-filter'
import {
  clampSessionTreeFocusIndex,
  getVisibleSessionTreeRows,
  resolveExpandedSessionTreeNodeIds,
  resolveSessionTreeRowExpandedNodeIds,
} from '../lib/session-tree-visibility'
import type { ExpandedNodeIdsOverride } from '../model'

const EMPTY_SESSION_NODES: readonly SessionNode[] = []

interface BuildSessionTreePanelRowsInput {
  readonly tree: SessionTree | null
  readonly transcriptPath: readonly { readonly node: SessionNode }[]
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
  readonly filteredNodes: readonly SessionNode[]
  readonly query: string
}) {
  if (!input.tree) {
    return EMPTY_SESSION_NODES
  }
  return searchSessionTreeNodes({
    nodes: input.tree.nodes,
    filteredNodes: input.filteredNodes,
    query: input.query,
  })
}

export function buildSessionTreePanelRows(input: BuildSessionTreePanelRowsInput) {
  const activePathIds = new Set(input.transcriptPath.map((entry) => String(entry.node.id)))
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
  })
  const searchActive = input.searchQuery.trim().length > 0
  const rowExpandedNodeIds = resolveSessionTreeRowExpandedNodeIds({
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
