import { SessionId } from '@shared/types/brand'
import { useNavigate } from '@tanstack/react-router'
import { useChatStore } from '@/features/chat/state'

/** Open a Session a Scheduled task run delivered into or launched, as the sidebar does. */
export function useOpenScheduledSession() {
  const navigate = useNavigate()
  return (sessionId: string) => {
    useChatStore.getState().setActiveSession(SessionId(sessionId))
    void navigate({ to: '/sessions/$sessionId', params: { sessionId } })
  }
}
