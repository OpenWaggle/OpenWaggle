import type { SessionNode } from '@shared/types/session'
import type { SessionTreeRow, SessionTreeRowsView } from '../model'

function isActivePathNode(node: SessionNode, activePathIds: ReadonlySet<string>) {
  return activePathIds.has(String(node.id))
}

function isExpandedNode(node: SessionNode, expandedNodeIds: readonly SessionNode['id'][]) {
  return expandedNodeIds.some((expandedNodeId) => String(expandedNodeId) === String(node.id))
}

export function buildSessionTreeRowState(input: {
  readonly row: SessionTreeRow
  readonly view: SessionTreeRowsView
}) {
  const node = input.row.node
  const activePath = isActivePathNode(node, input.view.activePathIds)
  const expanded = isExpandedNode(node, input.view.rowExpandedNodeIds)
  const nodeBranches = input.view.tree.branches.filter((branch) => branch.headNodeId === node.id)
  const isActiveBranchHead = nodeBranches.some((branch) => branch.id === input.view.activeBranchId)
  const isDraftNode =
    input.view.draftBranch?.sessionId === input.view.tree.session.id &&
    input.view.draftBranch.sourceNodeId === node.id
  const archivedBranch = nodeBranches.find((branch) => branch.archived === true)
  const nodeHighlighted = activePath || isActiveBranchHead || isDraftNode

  return {
    activePath,
    archivedBranch,
    expanded,
    isActiveBranchHead,
    isDraftNode,
    node,
    nodeBranches,
    nodeHighlighted,
    rowHighlighted: isActiveBranchHead || isDraftNode,
  }
}
