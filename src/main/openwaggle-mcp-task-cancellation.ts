import { SessionId } from '@shared/types/brand'
import {
  cancellationRequestedTaskRecord,
  cancelledTaskRecord,
  hasLiveLease,
  isActiveTaskStatus,
} from './openwaggle-mcp-task-leases'
import { projectTaskDelegationState } from './openwaggle-mcp-task-lineage'
import type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'
import type { OpenWaggleMcpTaskStore } from './openwaggle-mcp-task-store'

interface CancelSessionTasksInput {
  readonly abortTask: (taskId: string) => void
  readonly now: number
  readonly profile: string
  readonly services: OpenWaggleServerTaskServices
  readonly sessionId: string
  readonly store: OpenWaggleMcpTaskStore
}

export async function cancelOpenWaggleSessionTasks(input: CancelSessionTasksInput) {
  const result = await input.store.update((tasks) => {
    const matching = tasks.filter(
      (task) =>
        task.callerProfile === input.profile &&
        task.sessionId === input.sessionId &&
        isActiveTaskStatus(task.status),
    )
    const matchingIds = new Set(matching.map((task) => task.id))
    const projectedCancellation =
      matching.length > 0 && matching.every((task) => !hasLiveLease(task, input.now))
    const nextTasks = tasks.map((task) => {
      if (!matchingIds.has(task.id)) return task
      return hasLiveLease(task, input.now)
        ? cancellationRequestedTaskRecord(task, input.now)
        : cancelledTaskRecord(task, input.now)
    })
    return { tasks: nextTasks, result: { projectedCancellation, taskIds: [...matchingIds] } }
  })
  for (const taskId of result.taskIds) input.abortTask(taskId)
  if (result.projectedCancellation) {
    await projectTaskDelegationState(input.services, SessionId(input.sessionId), 'cancelled')
  }
  return result.taskIds.length
}
