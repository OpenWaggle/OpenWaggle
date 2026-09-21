import type { ActionInvocation, ProjectTaskDiscovery } from '@shared/types/action-definitions'
export function actionTaskUnavailable(
  invocation: ActionInvocation,
  discovery: ProjectTaskDiscovery | undefined,
): string | undefined {
  if (invocation.type !== 'task' || !discovery) return undefined
  const reference = invocation.task
  const task = discovery.tasks.find(
    ({ reference: candidate }) =>
      candidate.provider === reference.provider &&
      candidate.source === reference.source &&
      candidate.task === reference.task &&
      candidate.directory === reference.directory &&
      candidate.environment === reference.environment,
  )
  return task ? task.unavailableReason : 'Task unavailable · choose another task'
}
