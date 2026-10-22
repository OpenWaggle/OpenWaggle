import type { ScheduledTask } from '@shared/types/scheduled-task'
import { create } from 'zustand'
import { launchedSessionNames } from '../lib/task-groups'

interface ScheduledTaskIndexState {
  /** Session id → the Launch schedule that started it, for the sidebar provenance icon. */
  readonly launchedBy: Readonly<Record<string, string>>
  readonly attentionCount: number
  readonly index: (tasks: readonly ScheduledTask[]) => void
}

/**
 * A derived index of the Scheduled task list, written by the one shell-mounted monitor.
 *
 * Not a copy of the query cache: sidebar rows and the sidebar footer read one string or one
 * number each, and rows render where no QueryClient observer per row is wanted. The list query
 * stays the source of truth.
 */
export const useScheduledTaskIndexStore = create<ScheduledTaskIndexState>((set) => ({
  launchedBy: {},
  attentionCount: 0,
  index: (tasks) =>
    set({
      launchedBy: launchedSessionNames(tasks),
      attentionCount: tasks.filter((task) => task.attention !== null).length,
    }),
}))
