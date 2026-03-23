import { randomUUID } from 'node:crypto'
import type { JsonObject, JsonValue } from '@shared/types/json'
import { normalizeRetryPolicy, normalizeTimeout } from './engine-utils'
import type {
  OrchestrationRunDefinition,
  OrchestrationRunRecord,
  OrchestrationRunStatus,
  OrchestrationTaskAttempt,
  OrchestrationTaskOutputValue,
  OrchestrationTaskRetryPolicy,
  OrchestrationTaskStatus,
  RunSummary,
} from './types'

export interface MutableRunState {
  runId: string
  status: OrchestrationRunStatus
  startedAt: string
  finishedAt?: string
  maxParallelTasks: number
  tasks: Map<string, MutableTask>
  taskOrder: string[]
  outputs: { [taskId: string]: OrchestrationTaskOutputValue }
}

export interface MutableTask {
  id: string
  kind: string
  dependsOn: string[]
  input?: JsonValue
  output?: OrchestrationTaskOutputValue
  status: OrchestrationTaskStatus
  retry: Required<OrchestrationTaskRetryPolicy>
  timeoutMs?: number
  attempts: OrchestrationTaskAttempt[]
  startedAt?: string
  finishedAt?: string
  errorCode?: string
  error?: string
  metadata?: Readonly<JsonObject>
  createdOrder: number
}

const DEFAULT_MAX_PARALLEL_TASKS = 4

export function buildInitialState(
  definition: OrchestrationRunDefinition,
  nowIso: () => string,
): MutableRunState {
  const runId = definition.runId ?? randomUUID()
  const tasks = new Map<string, MutableTask>()
  const taskOrder: string[] = []

  definition.tasks.forEach((task, index) => {
    if (tasks.has(task.id)) {
      throw new Error(`duplicate task id '${task.id}' in run '${runId}'`)
    }

    const nextTask: MutableTask = {
      id: task.id,
      kind: task.kind,
      dependsOn: [...(task.dependsOn ?? [])],
      input: task.input,
      status: 'queued',
      retry: normalizeRetryPolicy(task.retry),
      timeoutMs: normalizeTimeout(task.timeoutMs),
      attempts: [],
      metadata: task.metadata,
      createdOrder: index,
    }

    tasks.set(task.id, nextTask)
    taskOrder.push(task.id)
  })

  for (const task of tasks.values()) {
    for (const dependency of task.dependsOn) {
      if (!tasks.has(dependency)) {
        throw new Error(`task '${task.id}' depends on unknown task '${dependency}'`)
      }
    }
  }

  return {
    runId,
    status: 'running',
    startedAt: nowIso(),
    maxParallelTasks: Math.max(
      1,
      Math.floor(definition.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS),
    ),
    tasks,
    taskOrder,
    outputs: {},
  }
}

export function restoreState(snapshot: OrchestrationRunRecord): MutableRunState {
  const tasks = new Map<string, MutableTask>()

  for (const taskId of snapshot.taskOrder) {
    const task = snapshot.tasks[taskId]
    if (!task) {
      continue
    }
    tasks.set(taskId, {
      id: task.id,
      kind: task.kind,
      dependsOn: [...task.dependsOn],
      input: task.input,
      output: task.output,
      status: task.status === 'running' || task.status === 'retrying' ? 'queued' : task.status,
      retry: task.retry,
      timeoutMs: task.timeoutMs,
      attempts: [...task.attempts],
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      errorCode: task.errorCode,
      error: task.error,
      metadata: task.metadata,
      createdOrder: task.createdOrder,
    })
  }

  return {
    runId: snapshot.runId,
    status: 'running',
    startedAt: snapshot.startedAt,
    maxParallelTasks: snapshot.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS,
    tasks,
    taskOrder: [...snapshot.taskOrder],
    outputs: { ...snapshot.outputs },
  }
}

export function snapshotState(state: MutableRunState): OrchestrationRunRecord {
  const tasks: Record<string, import('./types').OrchestrationTaskRecord> = {}
  for (const taskId of state.taskOrder) {
    const task = state.tasks.get(taskId)
    if (!task) {
      continue
    }

    tasks[taskId] = {
      id: task.id,
      kind: task.kind,
      dependsOn: [...task.dependsOn],
      input: task.input,
      output: task.output,
      status: task.status,
      retry: task.retry,
      timeoutMs: task.timeoutMs,
      attempts: [...task.attempts],
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      errorCode: task.errorCode,
      error: task.error,
      metadata: task.metadata,
      createdOrder: task.createdOrder,
    }
  }

  const allTasks = Object.values(tasks)
  const summary = {
    total: allTasks.length,
    completed: allTasks.filter((task) => task.status === 'completed').length,
    failed: allTasks.filter((task) => task.status === 'failed').length,
    cancelled: allTasks.filter((task) => task.status === 'cancelled').length,
    queued: allTasks.filter((task) => task.status === 'queued').length,
    running: allTasks.filter((task) => task.status === 'running').length,
    retrying: allTasks.filter((task) => task.status === 'retrying').length,
  }

  return {
    runId: state.runId,
    status: state.status,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    maxParallelTasks: state.maxParallelTasks,
    tasks,
    taskOrder: [...state.taskOrder],
    outputs: { ...state.outputs },
    summary,
  }
}

export function toRunSummary(snapshot: OrchestrationRunRecord): RunSummary {
  const failedTaskIds = snapshot.taskOrder.filter(
    (taskId) => snapshot.tasks[taskId]?.status === 'failed',
  )
  const cancelledTaskIds = snapshot.taskOrder.filter(
    (taskId) => snapshot.tasks[taskId]?.status === 'cancelled',
  )

  return {
    runId: snapshot.runId,
    status: snapshot.status,
    outputs: snapshot.outputs,
    failedTaskIds,
    cancelledTaskIds,
  }
}
