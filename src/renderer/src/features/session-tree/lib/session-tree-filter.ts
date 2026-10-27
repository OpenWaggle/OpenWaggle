import { match } from '@diegogbrisa/ts-match'
import type { SessionTreeFilterMode, SessionTreeNode } from '@shared/types/session'

const BOOKKEEPING_NODE_KINDS: ReadonlySet<SessionTreeNode['kind']> = new Set([
  'label',
  'custom',
  'model_change',
  'thinking_level_change',
  'session_info',
])

function isBookkeepingNode(node: SessionTreeNode) {
  return BOOKKEEPING_NODE_KINDS.has(node.kind)
}

function isToolNode(node: SessionTreeNode) {
  return node.kind === 'tool_result'
}

function isUserNode(node: SessionTreeNode) {
  return node.kind === 'user_message' || node.role === 'user'
}

function isLabeledNode(node: SessionTreeNode) {
  return node.kind === 'label'
}

function nodeKey(node: SessionTreeNode) {
  return String(node.id)
}

function parentKey(node: SessionTreeNode) {
  return node.parentId ? String(node.parentId) : null
}

function normalizeSearchText(text: string) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * What the window can match itself: a node's identity and the start of its text. Its full text is
 * matched on the Host (`sessions:search-tree`), since the tree carries no content (B5).
 */
function searchTextForNode(node: SessionTreeNode) {
  const parts = [
    String(node.id),
    node.kind.replace(/_/g, ' '),
    node.role ?? '',
    node.branchId ? String(node.branchId) : '',
    node.preview ?? '',
  ]
  return normalizeSearchText(parts.join(' '))
}

function addVisibleAncestors(input: {
  readonly node: SessionTreeNode
  readonly nodeById: ReadonlyMap<string, SessionTreeNode>
  readonly visibleNodeIdSet: ReadonlySet<string>
  readonly includedNodeIdSet: Set<string>
}) {
  let currentParentId = parentKey(input.node)

  while (currentParentId) {
    const parent = input.nodeById.get(currentParentId)
    if (!parent) {
      return
    }
    if (input.visibleNodeIdSet.has(currentParentId)) {
      input.includedNodeIdSet.add(currentParentId)
    }
    currentParentId = parentKey(parent)
  }
}

export function filterSessionTreeNodes(
  nodes: readonly SessionTreeNode[],
  mode: SessionTreeFilterMode,
): readonly SessionTreeNode[] {
  return match(mode)
    .with('all', () => nodes)
    .with('user-only', () => nodes.filter(isUserNode))
    .with('labeled-only', () => nodes.filter(isLabeledNode))
    .with('no-tools', () => nodes.filter((node) => !isBookkeepingNode(node) && !isToolNode(node)))
    .with('default', () => nodes.filter((node) => !isBookkeepingNode(node)))
    .exhaustive()
}

export function searchSessionTreeNodes(input: {
  readonly nodes: readonly SessionTreeNode[]
  readonly filteredNodes: readonly SessionTreeNode[]
  readonly query: string
  /** Node ids whose full transcript text the Host matched for this query. */
  readonly textMatchNodeIds?: ReadonlySet<string>
}): readonly SessionTreeNode[] {
  const normalizedQuery = normalizeSearchText(input.query)
  if (!normalizedQuery) {
    return input.filteredNodes
  }

  const nodeById = new Map(input.nodes.map((node) => [nodeKey(node), node]))
  const visibleNodeIdSet = new Set(input.filteredNodes.map(nodeKey))
  const includedNodeIdSet = new Set<string>()

  for (const node of input.filteredNodes) {
    const matched =
      input.textMatchNodeIds?.has(nodeKey(node)) === true ||
      searchTextForNode(node).includes(normalizedQuery)
    if (!matched) {
      continue
    }
    includedNodeIdSet.add(nodeKey(node))
    addVisibleAncestors({ node, nodeById, visibleNodeIdSet, includedNodeIdSet })
  }

  return input.filteredNodes.filter((node) => includedNodeIdSet.has(nodeKey(node)))
}
