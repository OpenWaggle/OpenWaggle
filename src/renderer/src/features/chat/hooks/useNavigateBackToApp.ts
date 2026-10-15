import { useNavigate } from '@tanstack/react-router'
import { useChat } from './useChat'

/**
 * "Back to app" for full-page routes (Settings, Usage & Cost) that hide the sidebar and header:
 * return to the active session, or to the start view when none is open.
 */
export function useNavigateBackToApp(): () => void {
  const navigate = useNavigate()
  const { activeSessionId } = useChat()

  return () => {
    if (activeSessionId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId: String(activeSessionId) },
      })
      return
    }
    void navigate({ to: '/' })
  }
}
