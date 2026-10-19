import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionWorkspace } from '@shared/types/session'
import { findAssistantMessageNode, findUserMessageNode } from './branch-from-message'
import { currentConversationWorkspace } from './current-conversation-node'
import { getVisibleForkTargets } from './session-fork-targets'

/** What a Session copy reads its source node from: the Session shown and its loaded transcript. */
export interface SessionCopySource {
  readonly activeWorkspace: SessionWorkspace | null
  readonly messages: readonly UIMessage[]
}

type FindNode = typeof findUserMessageNode

/**
 * The persisted node a transcript message was saved as. A message sent since the workspace was
 * loaded is not in it yet (runs refresh only the Session detail), so the current workspace is read
 * for it.
 */
async function findPersistedNode(
  source: SessionCopySource,
  sessionId: SessionId,
  messageId: string,
  find: FindNode,
): Promise<SessionNodeId | null> {
  const loaded =
    source.activeWorkspace?.tree.session.id === sessionId ? source.activeWorkspace : null
  const node = find({ messages: source.messages, workspace: loaded, messageId })
  if (node) return node.id
  const current = await currentConversationWorkspace(sessionId, loaded, { keepEarlierNode: false })
  return find({ messages: source.messages, workspace: current, messageId })?.id ?? null
}

/** The user-message node a fork starts before. */
export function findForkSourceNodeId(
  source: SessionCopySource,
  sessionId: SessionId,
  messageId: string,
) {
  return findPersistedNode(source, sessionId, messageId, findUserMessageNode)
}

/** The assistant-message node of a turn's reply, which a fork from that response copies through. */
export function findReplyNodeId(
  source: SessionCopySource,
  sessionId: SessionId,
  messageId: string,
) {
  return findPersistedNode(source, sessionId, messageId, findAssistantMessageNode)
}

/** Fork targets from the current workspace, which includes messages sent since the last load. */
export async function currentForkTargets(source: SessionCopySource, sessionId: SessionId) {
  return getVisibleForkTargets(
    await currentConversationWorkspace(sessionId, source.activeWorkspace),
  )
}
