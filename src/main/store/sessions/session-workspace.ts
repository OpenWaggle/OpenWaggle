import type { SessionId } from '@shared/types/brand'
import type { SessionWorkspace, SessionWorkspaceSelection } from '@shared/types/session'
import { getSessionTree } from './session-tree'
import { buildSessionWorkspace } from './workspace'

export async function getSessionWorkspace(
  sessionId: SessionId,
  selection?: SessionWorkspaceSelection,
): Promise<SessionWorkspace | null> {
  const tree = await getSessionTree(sessionId)
  return tree ? buildSessionWorkspace(tree, selection) : null
}
