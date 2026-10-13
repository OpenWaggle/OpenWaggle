import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { isAgentLoopAuditNode } from './agent-loop-audit-node'

/**
 * Refresh nodes no conversation follows: every node below them is a refresh too. Peeled from the
 * leaves without recursion, since a long transcript is one deep chain.
 */
function trailingRefreshIds(nodes: readonly ProjectedSessionNodeInput[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const remainingChildren = new Map<string, number>()
  for (const node of nodes) {
    if (node.parentId && nodeById.has(node.parentId)) {
      remainingChildren.set(node.parentId, (remainingChildren.get(node.parentId) ?? 0) + 1)
    }
  }
  const pending = nodes.filter(
    (node) => node.piEntryType === 'usage' && !remainingChildren.has(node.id),
  )
  const trailing = new Set<string>()
  for (let node = pending.pop(); node; node = pending.pop()) {
    trailing.add(node.id)
    const parent = node.parentId ? nodeById.get(node.parentId) : undefined
    if (!parent) continue
    const left = (remainingChildren.get(parent.id) ?? 1) - 1
    remainingChildren.set(parent.id, left)
    if (left === 0 && parent.piEntryType === 'usage') pending.push(parent)
  }
  return trailing
}

/**
 * The nodes that make up branches: no agent-loop audit nodes, and no cache-refresh `usage` nodes
 * that end a path. A warming session parents a refresh on the head; with no conversation after
 * it, it is part of no branch (older files may hold refreshes beside the next message).
 */
export function branchDerivationNodes(nodes: readonly ProjectedSessionNodeInput[]) {
  const conversation = nodes.filter((node) => !isAgentLoopAuditNode(node))
  const trailing = trailingRefreshIds(conversation)
  return conversation.filter((node) => !trailing.has(node.id))
}

/** A trailing refresh selected as the Pi leaf stands for the conversation node it follows. */
export function branchActiveNodeId(
  nodes: readonly ProjectedSessionNodeInput[],
  kept: readonly ProjectedSessionNodeInput[],
  activeNodeId: string | null,
) {
  const keptIds = new Set(kept.map((node) => node.id))
  const parentById = new Map(nodes.map((node) => [node.id, node.parentId]))
  let current = activeNodeId
  while (current && !keptIds.has(current)) current = parentById.get(current) ?? null
  return current
}
