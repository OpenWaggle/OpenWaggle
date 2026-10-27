import { useChatStore } from '@/features/chat/state'
import { useSessionProjectPath } from '@/features/sessions/hooks'

/** The Session and project the Scheduled surface shows, for its body and its header alike. */
export function useScheduledTasksPanelScope() {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  return {
    sessionId: activeSessionId === null ? null : String(activeSessionId),
    projectPath: useSessionProjectPath(),
  }
}
