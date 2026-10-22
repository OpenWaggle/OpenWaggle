import { useScheduledTaskIndexStore } from '../state/scheduled-task-index-store'

/** Name of the Launch schedule that started this Session, if one did. */
export function useScheduledTaskLaunchedBy(sessionId: string): string | null {
  return useScheduledTaskIndexStore((state) => state.launchedBy[sessionId] ?? null)
}

/** Whether any Scheduled task needs attention, for the sidebar's dot. */
export function useScheduledTasksNeedAttention(): boolean {
  return useScheduledTaskIndexStore((state) => state.attentionCount > 0)
}
