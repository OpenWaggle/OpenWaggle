import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionWorkspace } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('current-conversation')

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
 * The workspace a Session copy should work from: the loaded one when it shows an explicitly
 * selected earlier node, otherwise the Host's current workspace for the branch on screen.
 *
 * The loaded workspace is not refreshed when a run finishes (the transcript shows the new turn from
 * the Session detail), so its head is the one from before the last run. Cloning that head silently
 * dropped the latest turn, and a message sent since the load could not be forked. A failed read
 * falls back to the loaded workspace.
 */
export async function currentConversationWorkspace(
  sessionId: SessionId,
  workspace: SessionWorkspace | null,
): Promise<SessionWorkspace | null> {
  const ownWorkspace = workspace?.tree.session.id === sessionId ? workspace : null
  if (ownWorkspace && selectsEarlierNode(ownWorkspace)) return ownWorkspace
  try {
    const current = await api.getSessionWorkspace(
      sessionId,
      ownWorkspace?.activeBranchId ? { branchId: ownWorkspace.activeBranchId } : undefined,
    )
    if (current?.tree.session.id === sessionId) return current
  } catch (error) {
    logger.warn('Could not read the current Session workspace; using the loaded one', {
      sessionId: String(sessionId),
      message: error instanceof Error ? error.message : String(error),
    })
  }
  return ownWorkspace
}

/** The node a Session copy starts from; see {@link currentConversationWorkspace}. */
export async function resolveCurrentConversationNode(
  sessionId: SessionId,
  workspace: SessionWorkspace | null,
): Promise<SessionNodeId | null> {
  return (await currentConversationWorkspace(sessionId, workspace))?.activeNodeId ?? null
}
