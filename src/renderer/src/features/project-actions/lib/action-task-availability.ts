import type {
  ActionInvocation,
  ProjectTaskDiscovery,
  ProjectTaskReference,
} from '@shared/types/action-definitions'
export function actionTaskUnavailable(
  invocation: ActionInvocation,
  discovery: ProjectTaskDiscovery | undefined,
): string | undefined {
  if (invocation.type !== 'task' || !discovery) return undefined
  const task = findDiscoveredTask(invocation.task, discovery)
  return task ? task.unavailableReason : 'Task unavailable · choose another task'
}

export function findDiscoveredTask(
  reference: ProjectTaskReference,
  discovery: ProjectTaskDiscovery | undefined,
) {
  return discovery?.tasks.find(
    ({ reference: candidate }) =>
      candidate.provider === reference.provider &&
      candidate.source === reference.source &&
      candidate.task === reference.task &&
      candidate.directory === reference.directory &&
      candidate.environment === reference.environment,
  )
}
