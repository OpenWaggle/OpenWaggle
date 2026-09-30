import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'

/** Whether the workspace shows a node before the head of a known branch. */
function selectsEarlierNode(workspace: SessionWorkspace) {
  const branch = workspace.tree.branches.find((item) => item.id === workspace.activeBranchId)
  return (
    branch !== undefined &&
    workspace.activeNodeId !== null &&
    branch.headNodeId !== workspace.activeNodeId
  )
}

/**
 * The conversation node a Session copy should start from: an explicitly selected earlier node, or
 * the current head of the branch on screen.
 *
 * The loaded workspace is not refreshed when a run finishes (the transcript shows the new turn from
 * the Session detail), so its head is the one from before the last run. Cloning that head silently
 * dropped the latest turn, so a head is read again from the Host.
 */
export async function resolveCurrentConversationNode(
  sessionId: SessionId,
  workspace: SessionWorkspace | null,
): Promise<SessionNodeId | null> {
  const ownWorkspace = workspace?.tree.session.id === sessionId ? workspace : null
  if (ownWorkspace?.activeNodeId && selectsEarlierNode(ownWorkspace)) {
    return ownWorkspace.activeNodeId
  }
  const current = await api.getSessionWorkspace(
    sessionId,
    ownWorkspace?.activeBranchId ? { branchId: ownWorkspace.activeBranchId } : undefined,
  )
  return current?.activeNodeId ?? ownWorkspace?.activeNodeId ?? null
}
