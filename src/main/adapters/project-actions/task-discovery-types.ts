import type {
  DiscoveredProjectTask,
  ProjectTaskDiscovery,
  ProjectTaskProvider,
  ProjectTaskReference,
} from '@shared/types/action-definitions'

export interface ProjectTaskReader {
  readonly provider: ProjectTaskProvider
  readonly list: (
    workspace: string,
    reference?: ProjectTaskReference,
  ) => Promise<ProjectTaskDiscovery>
}

export function sameTaskReference(left: ProjectTaskReference, right: ProjectTaskReference) {
  return (
    left.provider === right.provider &&
    left.source === right.source &&
    left.task === right.task &&
    left.directory === right.directory &&
    left.environment === right.environment
  )
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
