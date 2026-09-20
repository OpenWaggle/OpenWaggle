import { SessionId } from '@shared/types/brand'
import {
  cancellationRequestedTaskRecord,
  cancelledTaskRecord,
  hasLiveLease,
  isActiveTaskStatus,
} from './openwaggle-mcp-task-leases'
import {
  authoritativeTaskForSession,
  projectTaskStateIfAuthoritative,
} from './openwaggle-mcp-task-reconciliation'
import type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'
import type { OpenWaggleMcpTaskStore } from './openwaggle-mcp-task-store'

interface CancelTaskInput {
  readonly abortTask: (taskId: string) => void
  readonly now: number
  readonly profile: string
  readonly services: OpenWaggleServerTaskServices
  readonly store: OpenWaggleMcpTaskStore
  readonly taskId: string
}

export async function cancelOpenWaggleTask(input: CancelTaskInput) {
  const transition = await input.store.update((tasks) => {
    const previous = tasks.find(
      (task) => task.id === input.taskId && task.callerProfile === input.profile,
    )
    if (!previous) throw new Error(`OpenWaggle task ${JSON.stringify(input.taskId)} was not found.`)
    const next = isActiveTaskStatus(previous.status)
      ? hasLiveLease(previous, input.now)
        ? cancellationRequestedTaskRecord(previous, input.now)
        : cancelledTaskRecord(previous, input.now)
      : previous
    const nextTasks = tasks.map((task) => (task.id === input.taskId ? next : task))
    const authoritative = next.sessionId
      ? authoritativeTaskForSession(nextTasks, next.sessionId)
      : null
    const projectCancellation =
      isActiveTaskStatus(previous.status) &&
      next.status === 'cancelled' &&
      authoritative?.id === next.id
    return { tasks: nextTasks, result: { next, projectCancellation } }
  })
  input.abortTask(input.taskId)
  if (transition.projectCancellation && transition.next.sessionId) {
    await projectTaskStateIfAuthoritative(
      { services: input.services, store: input.store },
      transition.next.id,
      SessionId(transition.next.sessionId),
      'cancelled',
    )
  }
  return transition.next
}

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
    const cancelledIds = new Set<string>()
    for (const task of matching) {
      if (!hasLiveLease(task, input.now)) cancelledIds.add(task.id)
    }
    const nextTasks = tasks.map((task) => {
      if (!matchingIds.has(task.id)) return task
      return hasLiveLease(task, input.now)
        ? cancellationRequestedTaskRecord(task, input.now)
        : cancelledTaskRecord(task, input.now)
    })
    const authoritative = authoritativeTaskForSession(nextTasks, input.sessionId)
    const projectedTaskId =
      authoritative && cancelledIds.has(authoritative.id) && authoritative.status === 'cancelled'
        ? authoritative.id
        : null
    return { tasks: nextTasks, result: { projectedTaskId, taskIds: [...matchingIds] } }
  })
  for (const taskId of result.taskIds) input.abortTask(taskId)
  if (result.projectedTaskId) {
    await projectTaskStateIfAuthoritative(
      { services: input.services, store: input.store },
      result.projectedTaskId,
      SessionId(input.sessionId),
      'cancelled',
    )
  }
  return result.taskIds.length
}
