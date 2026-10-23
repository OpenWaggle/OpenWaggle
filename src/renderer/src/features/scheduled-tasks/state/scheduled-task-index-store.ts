import type { ScheduledTask } from '@shared/types/scheduled-task'
import { create } from 'zustand'
import { type ScheduledTaskProjects, scheduledTaskProjects } from '../lib/scheduled-tasks-view'
import { launchedSessionNames } from '../lib/task-groups'

interface ScheduledTaskIndexState {
  /** Session id → the Launch schedule that started it, for the sidebar provenance icon. */
  readonly launchedBy: Readonly<Record<string, string>>
  readonly attentionCount: number
  /** Projects with a task that needs attention, for the Right panel rail marker. */
  readonly attentionProjectPaths: readonly string[]
  /** Task id → name, for titles that render where no QueryClient observer is wanted. */
  readonly names: Readonly<Record<string, string>>
  /** Task id → project, or null until the list first loads, for the Right panel title. */
  readonly projects: ScheduledTaskProjects | null
  /** Sessions a Heartbeat runs in or a Launch schedule started, for the Session Summary. */
  readonly scheduledSessionIds: readonly string[]
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
  attentionProjectPaths: [],
  names: {},
  projects: null,
  scheduledSessionIds: [],
  index: (tasks) => {
    const needing = tasks.filter((task) => task.attention !== null)
    set({
      launchedBy: launchedSessionNames(tasks),
      names: Object.fromEntries(tasks.map((task) => [task.id, task.name])),
      projects: scheduledTaskProjects(tasks),
      scheduledSessionIds: [
        ...new Set(
          tasks.flatMap((task) =>
            task.target.kind === 'heartbeat' ? [task.target.sessionId] : task.recentSessionIds,
          ),
        ),
      ],
      attentionCount: needing.length,
      attentionProjectPaths: [
        ...new Set(
          needing.flatMap((task) => (task.projectPath === null ? [] : [task.projectPath])),
        ),
      ],
    })
  },
}))
