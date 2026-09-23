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
  // Discovery is capped; absence from its page is not proof that a saved task is gone.
  return task?.unavailableReason
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
