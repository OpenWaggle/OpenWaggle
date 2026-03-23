import { type ConversationId, OrchestrationRunId, OrchestrationTaskId } from '@shared/types/brand'
import type { OrchestrationRunRecord, OrchestrationTaskRecord } from '@shared/types/orchestration'
import type { OrchestrationRunRecord as CoreRunRecord } from './engine'

export const CANCELLED_ERROR_CODE = 'TASK_CANCELLED'
export const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

export function extractTaskTitle(task: CoreRunRecord['tasks'][string]): string | undefined {
  const input = task.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined
  }
  const title = input.title
  return typeof title === 'string' && title.trim().length > 0 ? title : undefined
}

export function toSharedTaskRecord(
  task: CoreRunRecord['tasks'][string],
  createdOrder: number,
): OrchestrationTaskRecord {
  return {
    id: OrchestrationTaskId(task.id),
    kind: task.kind,
    status: task.status,
    dependsOn: task.dependsOn.map((dependencyId) => OrchestrationTaskId(dependencyId)),
    title: extractTaskTitle(task),
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    errorCode: task.errorCode,
    error: task.error,
    retry: task.retry,
    attempts: task.attempts,
    createdOrder,
  }
}

export function toSharedRunRecord(
  core: CoreRunRecord,
  conversationId: ConversationId,
  fallbackUsed: boolean,
  fallbackReason?: string,
): OrchestrationRunRecord {
  const tasks: Record<string, OrchestrationTaskRecord> = {}
  for (let index = 0; index < core.taskOrder.length; index += 1) {
    const taskId = core.taskOrder[index]
    const task = core.tasks[taskId]
    if (!task) {
      continue
    }
    tasks[taskId] = toSharedTaskRecord(task, task.createdOrder ?? index)
  }

  return {
    runId: OrchestrationRunId(core.runId),
    conversationId,
    status: core.status,
    startedAt: core.startedAt,
    finishedAt: core.finishedAt,
    maxParallelTasks: core.maxParallelTasks,
    taskOrder: core.taskOrder.map((taskId) => OrchestrationTaskId(taskId)),
    tasks,
    outputs: core.outputs,
    fallbackUsed,
    fallbackReason,
    updatedAt: Date.now(),
  }
}

export function summarizeCoreRun(tasks: Readonly<Record<string, CoreRunRecord['tasks'][string]>>) {
  const values = Object.values(tasks)
  return {
    total: values.length,
    completed: values.filter((task) => task.status === 'completed').length,
    failed: values.filter((task) => task.status === 'failed').length,
    cancelled: values.filter((task) => task.status === 'cancelled').length,
    queued: values.filter((task) => task.status === 'queued').length,
    running: values.filter((task) => task.status === 'running').length,
    retrying: values.filter((task) => task.status === 'retrying').length,
  }
}

export function normalizeRunId(runId: string): string | null {
  const trimmed = runId.trim()
  if (!trimmed) {
    return null
  }

  return RUN_ID_PATTERN.test(trimmed) ? trimmed : null
}
