import { useChatStore } from '@/features/chat/state'
import { ScheduledTasksPanel } from '@/features/scheduled-tasks'
import { useSessionProjectPath } from '@/features/sessions/hooks'

/** The Session and project the Scheduled surface shows, for its body and its header alike. */
export function useScheduledTasksPanelScope() {
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  return {
    sessionId: activeSessionId === null ? null : String(activeSessionId),
    projectPath: useSessionProjectPath(),
  }
}

/** Hosts the Scheduled surface for the open Session's project (ADR 0057). */
export function WorkspaceScheduledTasksSurface() {
  const scope = useScheduledTasksPanelScope()
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <ScheduledTasksPanel sessionId={scope.sessionId} projectPath={scope.projectPath} />
    </div>
  )
}
