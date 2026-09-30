import type { SessionId } from '@shared/types/brand'
import type { useNavigate } from '@tanstack/react-router'
import { useChatStore } from '../state/chat-store'

/**
 * Drops a routed conversation node so the Session's view follows the head of its branch. Only the
 * Session still open is re-routed: a send can settle after the user has moved to another one.
 */
export function followBranchHead(navigate: ReturnType<typeof useNavigate>, sessionId: SessionId) {
  if (useChatStore.getState().activeSessionId !== sessionId) return
  void navigate({
    to: '/sessions/$sessionId',
    params: { sessionId: String(sessionId) },
    search: (previous) => ({ ...previous, node: undefined }),
  })
}
