import type {
  SessionBranch,
  SessionNode,
  SessionTree,
  SessionWorkspaceSelection,
} from '@shared/types/session'
import { buildPiWorkingContextPath } from '../session-working-context'

function findBranchById(
  branches: readonly SessionBranch[],
  branchId: SessionBranch['id'] | null | undefined,
) {
  if (!branchId) return null
  return branches.find((branch) => branch.id === branchId) ?? null
}

function findNodeById(nodes: readonly SessionNode[], nodeId: SessionNode['id'] | null | undefined) {
  if (!nodeId) return null
  return nodes.find((node) => node.id === nodeId) ?? null
}

function isVisibleBranch(branch: SessionBranch) {
  return branch.archived !== true
}

function getDefaultBranch(tree: SessionTree) {
  return (
    tree.branches.find((branch) => branch.isMain && isVisibleBranch(branch)) ??
    tree.branches.find(isVisibleBranch) ??
    tree.branches[0] ??
    null
  )
}

function getNodeBranch(tree: SessionTree, node: SessionNode | null) {
  return node?.branchId ? findBranchById(tree.branches, node.branchId) : null
}

function resolveWorkspaceBranch(
  tree: SessionTree,
  selection: SessionWorkspaceSelection | undefined,
  selectedNode: SessionNode | null,
) {
  return (
    findBranchById(tree.branches, selection?.branchId) ??
    getNodeBranch(tree, selectedNode) ??
    tree.branches.find(
      (branch) => branch.id === tree.session.lastActiveBranchId && isVisibleBranch(branch),
    ) ??
    getDefaultBranch(tree)
  )
}

function resolveWorkspaceNode(
  tree: SessionTree,
  selection: SessionWorkspaceSelection | undefined,
  activeBranch: SessionBranch | null,
) {
  return (
    findNodeById(tree.nodes, selection?.nodeId) ??
    findNodeById(tree.nodes, activeBranch?.headNodeId) ??
    findNodeById(tree.nodes, tree.session.lastActiveNodeId) ??
    tree.nodes[tree.nodes.length - 1] ??
    null
  )
}

function buildTranscriptPath(tree: SessionTree, activeNodeId: SessionNode['id'] | null) {
  return buildPiWorkingContextPath(activeNodeId ? String(activeNodeId) : null, tree.nodes, {
    getId: (node) => String(node.id),
    getParentId: (node) => (node.parentId ? String(node.parentId) : null),
    getKind: (node) => node.kind,
    getContentJson: (node) => node.contentJson,
  }).map((node) => ({
    node,
    branchId: node.branchId,
    isActive: node.id === activeNodeId,
  }))
}

export function buildSessionWorkspace(tree: SessionTree, selection?: SessionWorkspaceSelection) {
  const selectedNode = findNodeById(tree.nodes, selection?.nodeId)
  const activeBranch = resolveWorkspaceBranch(tree, selection, selectedNode)
  const activeNode = resolveWorkspaceNode(tree, selection, activeBranch)
  const activeBranchState = tree.branchStates.find((state) => state.branchId === activeBranch?.id)

  return {
    tree,
    activeBranchId: activeBranch?.id ?? null,
    activeNodeId: activeNode?.id ?? null,
    activeBranchState,
    transcriptPath: buildTranscriptPath(tree, activeNode?.id ?? null),
  }
}
