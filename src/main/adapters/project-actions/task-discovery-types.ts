import type {
  DiscoveredProjectTask,
  ProjectTaskDiscovery,
  ProjectTaskProvider,
} from '@shared/types/action-definitions'

export interface ProjectTaskReader {
  readonly provider: ProjectTaskProvider
  readonly list: (workspace: string) => Promise<ProjectTaskDiscovery>
}

export function taskReadError(source: string, error: unknown) {
  return { source, message: error instanceof Error ? error.message : String(error) }
}

export function isInvocableTaskName(name: string): boolean {
  return name.trim().length > 0 && !name.startsWith('-') && !/[\0\r\n]/.test(name)
}

export function limitDiscoveredTasks(tasks: DiscoveredProjectTask[], limit: number) {
  if (tasks.length > limit) throw new Error(`Task discovery exceeds the limit of ${limit} tasks.`)
  return tasks
}
