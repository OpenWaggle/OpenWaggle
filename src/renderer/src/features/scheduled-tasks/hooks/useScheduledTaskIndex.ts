import { useScheduledTaskIndexStore } from '../state/scheduled-task-index-store'

/** Name of the Launch schedule that started this Session, if one did. */
export function useScheduledTaskLaunchedBy(sessionId: string): string | null {
  return useScheduledTaskIndexStore((state) => state.launchedBy[sessionId] ?? null)
}

/** Whether any Scheduled task needs attention, for the Settings tab's dot. */
export function useScheduledTasksNeedAttention(): boolean {
  return useScheduledTaskIndexStore((state) => state.attentionCount > 0)
}

/** Whether a task in this project needs attention, for the Right panel rail marker. */
export function useProjectScheduledTasksNeedAttention(projectPath: string | null): boolean {
  return useScheduledTaskIndexStore(
    (state) => projectPath !== null && state.attentionProjectPaths.includes(projectPath),
  )
}

/** Whether a Heartbeat runs in this Session or a Launch schedule started it. */
export function useSessionHasScheduledTasks(sessionId: string | null): boolean {
  return useScheduledTaskIndexStore(
    (state) => sessionId !== null && state.scheduledSessionIds.includes(sessionId),
  )
}
