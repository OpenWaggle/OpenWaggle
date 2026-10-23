import type { ScheduledTask } from '@shared/types/scheduled-task'
import type { ScheduledTasksView } from '../state/scheduled-tasks-navigation-store'

const LIST: ScheduledTasksView = { kind: 'list' }

/** Task id → its project, the one fact a container needs to tell whether it can show a task. */
export type ScheduledTaskProjects = Readonly<Record<string, string | null>>

export function scheduledTaskProjects(tasks: readonly ScheduledTask[]): ScheduledTaskProjects {
  return Object.fromEntries(tasks.map((task) => [task.id, task.projectPath]))
}

/**
 * The view a container can actually show: a task that was deleted, or that belongs to another
 * project than the Right panel's, falls back to the list instead of an empty or foreign detail.
 * The panel body and its header title both resolve through here, so they never disagree.
 */
export function shownScheduledTasksView(
  view: ScheduledTasksView,
  projects: ScheduledTaskProjects | null | undefined,
  scope: { readonly projectPath: string | null; readonly sessionId?: string | null } | null,
): ScheduledTasksView {
  if (view.kind === 'list' || !projects) return view
  if (view.kind === 'new') {
    if (scope === null) return view
    const { defaults } = view
    if (defaults.sessionId !== undefined && defaults.sessionId !== scope.sessionId) return LIST
    if (defaults.projectPath !== undefined && defaults.projectPath !== scope.projectPath) {
      return LIST
    }
    return view
  }
  if (!(view.taskId in projects)) return LIST
  if (scope !== null && projects[view.taskId] !== scope.projectPath) return LIST
  return view
}
