import { match } from '@diegogbrisa/ts-match'
import { getMessageText } from '@shared/types/agent'
import type { SessionNode, SessionTreeFilterMode } from '@shared/types/session'

const BOOKKEEPING_NODE_KINDS: ReadonlySet<SessionNode['kind']> = new Set([
  'label',
  'custom',
  'model_change',
  'thinking_level_change',
  'session_info',
])

function isBookkeepingNode(node: SessionNode) {
  return BOOKKEEPING_NODE_KINDS.has(node.kind)
}

function isToolNode(node: SessionNode) {
  return node.kind === 'tool_result'
}

function isUserNode(node: SessionNode) {
  return node.kind === 'user_message' || node.role === 'user'
}

function isLabeledNode(node: SessionNode) {
  return node.kind === 'label'
}

function nodeKey(node: SessionNode) {
  return String(node.id)
}

function parentKey(node: SessionNode) {
  return node.parentId ? String(node.parentId) : null
}

function normalizeSearchText(text: string) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

function searchTextForNode(node: SessionNode) {
  const parts = [
    String(node.id),
    node.kind.replace(/_/g, ' '),
    node.role ?? '',
    node.branchId ? String(node.branchId) : '',
    node.contentJson,
    node.metadataJson,
  ]
  if (node.message) {
    parts.push(getMessageText(node.message))
  }
  return normalizeSearchText(parts.join(' '))
}

function addVisibleAncestors(input: {
  readonly node: SessionNode
  readonly nodeById: ReadonlyMap<string, SessionNode>
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
  nodes: readonly SessionNode[],
  mode: SessionTreeFilterMode,
): readonly SessionNode[] {
  return match(mode)
    .with('all', () => nodes)
    .with('user-only', () => nodes.filter(isUserNode))
    .with('labeled-only', () => nodes.filter(isLabeledNode))
    .with('no-tools', () => nodes.filter((node) => !isBookkeepingNode(node) && !isToolNode(node)))
    .with('default', () => nodes.filter((node) => !isBookkeepingNode(node)))
    .exhaustive()
}

export function searchSessionTreeNodes(input: {
  readonly nodes: readonly SessionNode[]
  readonly filteredNodes: readonly SessionNode[]
  readonly query: string
}): readonly SessionNode[] {
  const normalizedQuery = normalizeSearchText(input.query)
  if (!normalizedQuery) {
    return input.filteredNodes
  }

  const nodeById = new Map(input.nodes.map((node) => [nodeKey(node), node]))
  const visibleNodeIdSet = new Set(input.filteredNodes.map(nodeKey))
  const includedNodeIdSet = new Set<string>()

  for (const node of input.filteredNodes) {
    if (!searchTextForNode(node).includes(normalizedQuery)) {
      continue
    }
    includedNodeIdSet.add(nodeKey(node))
    addVisibleAncestors({ node, nodeById, visibleNodeIdSet, includedNodeIdSet })
  }

  return input.filteredNodes.filter((node) => includedNodeIdSet.has(nodeKey(node)))
}
