import type { ScheduledTask } from '@shared/types/scheduled-task'
import { projectName } from '@/shared/lib/format'

export interface ScheduledTaskProjectGroup {
  readonly projectPath: string | null
  readonly label: string
  readonly tasks: readonly ScheduledTask[]
}

/** Tasks grouped by owning project, projects and tasks in name order. */
export function groupTasksByProject(
  tasks: readonly ScheduledTask[],
): readonly ScheduledTaskProjectGroup[] {
  const byProject = new Map<string | null, ScheduledTask[]>()
  for (const task of tasks) {
    const group = byProject.get(task.projectPath)
    if (group) group.push(task)
    else byProject.set(task.projectPath, [task])
  }
  return [...byProject.entries()]
    .map(([projectPath, grouped]) => ({
      projectPath,
      label: projectName(projectPath),
      tasks: grouped.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

/** Heartbeats whose target is this Session. */
export function heartbeatsForSession(tasks: readonly ScheduledTask[], sessionId: string) {
  return tasks.filter(
    (task) => task.target.kind === 'heartbeat' && task.target.sessionId === sessionId,
  )
}

/** Session id → name of the Launch schedule that started it, newest run winning. */
export function launchedSessionNames(tasks: readonly ScheduledTask[]) {
  const names: Record<string, string> = {}
  for (const task of tasks) {
    if (task.kind !== 'launch') continue
    for (const sessionId of task.recentSessionIds) names[sessionId] ??= task.name
  }
  return names
}
