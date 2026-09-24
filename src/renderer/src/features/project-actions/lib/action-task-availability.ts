import type {
  ActionInvocation,
  ProjectTaskDiscovery,
  ProjectTaskReference,
} from '@shared/types/action-definitions'
import { ACTION_DEFINITION_LIMITS } from '@shared/types/action-definitions'
export function actionTaskUnavailable(
  invocation: ActionInvocation,
  discovery: ProjectTaskDiscovery | undefined,
): string | undefined {
  if (invocation.type !== 'task' || !discovery) return undefined
  const task = findDiscoveredTask(invocation.task, discovery)
  if (task) return task.unavailableReason
  // A capped or diagnostic-bearing result cannot prove that the saved task was removed.
  if (
    discovery.tasks.length >= ACTION_DEFINITION_LIMITS.DISCOVERED_TASKS ||
    discovery.diagnostics.length
  )
    return undefined
  return 'This saved task is no longer available in the workspace.'
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
