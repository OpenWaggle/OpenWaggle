import { randomUUID } from 'node:crypto'
import type { JsonObject, JsonValue } from '@shared/types/json'

import { MemoryRunStore } from './memory-run-store'
import {
  ORCHESTRATION_ERROR_TASK_CANCELLED,
  ORCHESTRATION_ERROR_TASK_EXECUTION,
  ORCHESTRATION_ERROR_TASK_TIMEOUT,
  type OrchestrationEngine,
  type OrchestrationEvent,
  type OrchestrationRunDefinition,
  type OrchestrationRunRecord,
  type OrchestrationRunStatus,
  type OrchestrationTaskAttempt,
  type OrchestrationTaskDefinition,
  type OrchestrationTaskOutputValue,
  type OrchestrationTaskRecord,
  type OrchestrationTaskRetryPolicy,
  type OrchestrationTaskStatus,
  type RunStore,
  type RunSummary,
  type WorkerAdapter,
} from './types'

interface MutableRunState {
  runId: string
  status: OrchestrationRunStatus
  startedAt: string
  finishedAt?: string
  maxParallelTasks: number
  tasks: Map<string, MutableTask>
  taskOrder: string[]
  outputs: { [taskId: string]: OrchestrationTaskOutputValue }
}

interface MutableTask {
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

interface OrchestrationEngineOptions {
  readonly workerAdapter: WorkerAdapter
  readonly runStore?: RunStore
  readonly onEvent?: (event: OrchestrationEvent) => void | Promise<void>
  readonly nowIso?: () => string
  readonly nowMs?: () => number
  readonly random?: () => number
  readonly sleep?: (delayMs: number) => Promise<void>
}

interface ActiveRun {
  readonly controller: AbortController
  readonly reasonRef: { reason?: string }
}

const DEFAULT_MAX_PARALLEL_TASKS = 4

export function createOrchestrationEngine(
  options: OrchestrationEngineOptions,
): OrchestrationEngine {
  const runStore = options.runStore ?? new MemoryRunStore()
  const onEvent = options.onEvent
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  const nowMs = options.nowMs ?? (() => Date.now())
  const random = options.random ?? Math.random
  const sleep = options.sleep ?? defaultSleep
  const activeRuns = new Map<string, ActiveRun>()

  async function emit(event: OrchestrationEvent): Promise<void> {
    await onEvent?.(event)
  }

  async function saveState(state: MutableRunState): Promise<OrchestrationRunRecord> {
    const snapshot = snapshotState(state)
    await runStore.saveRun(snapshot)
    return snapshot
  }

  async function registerTask(
    state: MutableRunState,
    task: OrchestrationTaskDefinition,
  ): Promise<void> {
    if (state.tasks.has(task.id)) {
      throw new Error(`task '${task.id}' already exists in run '${state.runId}'`)
    }

    const dependsOn = [...(task.dependsOn ?? [])]
    for (const dependency of dependsOn) {
      if (!state.tasks.has(dependency)) {
        throw new Error(
          `task '${task.id}' depends on unknown task '${dependency}' in run '${state.runId}'`,
        )
      }
    }

    const createdOrder = state.taskOrder.length
    const nextTask: MutableTask = {
      id: task.id,
      kind: task.kind,
      dependsOn,
      input: task.input,
      status: 'queued',
      retry: normalizeRetryPolicy(task.retry),
      timeoutMs: normalizeTimeout(task.timeoutMs),
      attempts: [],
      metadata: task.metadata,
      createdOrder,
    }

    state.tasks.set(task.id, nextTask)
    state.taskOrder.push(task.id)
    await emit({ type: 'task_queued', runId: state.runId, taskId: task.id, at: nowIso() })
    await saveState(state)
  }

  function buildInitialState(definition: OrchestrationRunDefinition): MutableRunState {
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

  function restoreState(snapshot: OrchestrationRunRecord): MutableRunState {
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
      maxParallelTasks: DEFAULT_MAX_PARALLEL_TASKS,
      tasks,
      taskOrder: [...snapshot.taskOrder],
      outputs: { ...snapshot.outputs },
    }
  }

  async function runInternal(
    state: MutableRunState,
    signal?: AbortSignal,
    reasonRef?: { reason?: string },
  ): Promise<RunSummary> {
    const runController = new AbortController()
    const activeReasonRef = reasonRef ?? { reason: undefined }

    signal?.addEventListener(
      'abort',
      () => {
        activeReasonRef.reason ??= 'external-abort'
        runController.abort()
      },
      { once: true },
    )

    activeRuns.set(state.runId, { controller: runController, reasonRef: activeReasonRef })

    const queue: string[] = []
    const inQueue = new Set<string>()
    const running = new Map<string, Promise<void>>()

    const enqueueIfReady = (taskId: string): void => {
      if (inQueue.has(taskId) || running.has(taskId)) {
        return
      }
      const task = state.tasks.get(taskId)
      if (!task) {
        return
      }
      if (task.status !== 'queued') {
        return
      }
      if (
        !task.dependsOn.every(
          (dependencyId) => state.tasks.get(dependencyId)?.status === 'completed',
        )
      ) {
        return
      }
      queue.push(taskId)
      queue.sort((left, right) => {
        const leftTask = state.tasks.get(left)
        const rightTask = state.tasks.get(right)
        return (leftTask?.createdOrder ?? 0) - (rightTask?.createdOrder ?? 0)
      })
      inQueue.add(taskId)
    }

    const enqueueAllReadyTasks = (): void => {
      for (const taskId of state.taskOrder) {
        enqueueIfReady(taskId)
      }
    }

    const markQueuedDependents = (completedTaskId: string): void => {
      for (const task of state.tasks.values()) {
        if (task.status !== 'queued') {
          continue
        }
        if (!task.dependsOn.includes(completedTaskId)) {
          continue
        }
        enqueueIfReady(task.id)
      }
    }

    const markRemainingCancelled = async (reason: string): Promise<void> => {
      for (const task of state.tasks.values()) {
        if (
          task.status === 'completed' ||
          task.status === 'failed' ||
          task.status === 'cancelled'
        ) {
          continue
        }
        task.status = 'cancelled'
        task.finishedAt = nowIso()
        task.errorCode = ORCHESTRATION_ERROR_TASK_CANCELLED
        task.error = reason
      }
      await saveState(state)
    }

    const startTask = async (taskId: string): Promise<void> => {
      const task = state.tasks.get(taskId)
      if (!task) {
        return
      }

      const attemptNumber = task.attempts.length + 1
      const startedAt = nowIso()
      const startedMs = nowMs()

      task.status = 'running'
      if (!task.startedAt) {
        task.startedAt = startedAt
      }
      const taskController = new AbortController()
      let timedOut = false
      const onRunAbort = (): void => taskController.abort()
      runController.signal.addEventListener('abort', onRunAbort, { once: true })

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null
      if (task.timeoutMs) {
        timeoutHandle = setTimeout(() => {
          timedOut = true
          taskController.abort()
        }, task.timeoutMs)
      }

      try {
        await emit({
          type: 'task_started',
          runId: state.runId,
          taskId,
          attempt: attemptNumber,
          at: startedAt,
        })
        await saveState(state)

        const dependencyOutputs = Object.fromEntries(
          task.dependsOn
            .filter((dependencyId) => dependencyId in state.outputs)
            .map((dependencyId) => [dependencyId, state.outputs[dependencyId]]),
        )

        const response = await options.workerAdapter.executeTask(taskToDefinition(task), {
          runId: state.runId,
          signal: taskController.signal,
          dependencyOutputs,
          reportProgress: (payload) => {
            emit({
              type: 'task_progress',
              runId: state.runId,
              taskId,
              at: nowIso(),
              payload,
            }).catch(() => {})
          },
          spawn: async (spawnedTask) => {
            await registerTask(state, spawnedTask)
            enqueueIfReady(spawnedTask.id)
          },
        })

        const finishedAt = nowIso()
        const durationMs = nowMs() - startedMs
        task.attempts.push({
          attempt: attemptNumber,
          status: 'ok',
          startedAt,
          finishedAt,
          durationMs,
        })
        task.status = 'completed'
        task.output = response.output
        task.finishedAt = finishedAt
        task.error = undefined
        task.errorCode = undefined
        if (typeof response.output !== 'undefined') {
          state.outputs[task.id] = response.output
        }

        await emit({
          type: 'task_succeeded',
          runId: state.runId,
          taskId,
          attempt: attemptNumber,
          at: finishedAt,
          output: response.output,
        })
        await saveState(state)
        markQueuedDependents(task.id)
      } catch (error) {
        const finishedAt = nowIso()
        const durationMs = nowMs() - startedMs
        const errorMessage = asErrorMessage(error)
        const errorCode = timedOut
          ? ORCHESTRATION_ERROR_TASK_TIMEOUT
          : runController.signal.aborted
            ? ORCHESTRATION_ERROR_TASK_CANCELLED
            : ORCHESTRATION_ERROR_TASK_EXECUTION

        const cancelledByRun = runController.signal.aborted
        const retryable = !cancelledByRun && shouldRetry(task.retry, attemptNumber)

        task.attempts.push({
          attempt: attemptNumber,
          status: cancelledByRun ? 'cancelled' : 'error',
          errorCode,
          error: errorMessage,
          startedAt,
          finishedAt,
          durationMs,
        })

        task.errorCode = errorCode
        task.error = errorMessage

        if (retryable) {
          const delayMs = retryDelayMs(task.retry, attemptNumber, random)
          task.status = 'retrying'
          task.finishedAt = finishedAt
          await emit({
            type: 'task_retried',
            runId: state.runId,
            taskId,
            attempt: attemptNumber,
            nextAttempt: attemptNumber + 1,
            delayMs,
            at: finishedAt,
            errorCode,
            error: errorMessage,
          })
          await saveState(state)
          if (delayMs > 0) {
            await sleep(delayMs)
          }
          if (!runController.signal.aborted) {
            task.status = 'queued'
            task.finishedAt = undefined
            await emit({ type: 'task_queued', runId: state.runId, taskId, at: nowIso() })
            await saveState(state)
            enqueueIfReady(task.id)
            return
          }
        }

        if (cancelledByRun) {
          task.status = 'cancelled'
        } else {
          task.status = 'failed'
        }
        task.finishedAt = finishedAt

        await emit({
          type: 'task_failed',
          runId: state.runId,
          taskId,
          attempt: attemptNumber,
          at: finishedAt,
          errorCode,
          error: errorMessage,
        })
        await saveState(state)
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
        }
        runController.signal.removeEventListener('abort', onRunAbort)
      }
    }

    await emit({ type: 'run_started', runId: state.runId, at: state.startedAt })
    await saveState(state)

    enqueueAllReadyTasks()

    try {
      while (true) {
        if (runController.signal.aborted) {
          const inFlightTasks = [...running.values()]
          if (inFlightTasks.length > 0) {
            await Promise.allSettled(inFlightTasks)
          }
          await markRemainingCancelled(activeReasonRef.reason ?? 'run-cancelled')
          state.status = 'cancelled'
          state.finishedAt = nowIso()
          await emit({
            type: 'run_cancelled',
            runId: state.runId,
            at: state.finishedAt,
            reason: activeReasonRef.reason,
          })
          await saveState(state)
          break
        }

        while (running.size < state.maxParallelTasks && queue.length > 0) {
          const nextTaskId = queue.shift()
          if (!nextTaskId) {
            break
          }
          inQueue.delete(nextTaskId)

          const promise = startTask(nextTaskId)
            .catch(() => {
              // Errors are persisted through task records.
            })
            .finally(() => {
              running.delete(nextTaskId)
            })
          running.set(nextTaskId, promise)
        }

        if (running.size === 0) {
          const failedTask = [...state.tasks.values()].find((task) => task.status === 'failed')
          if (failedTask) {
            await markRemainingCancelled(`dependency failed: ${failedTask.id}`)
            state.status = 'failed'
            state.finishedAt = nowIso()
            await emit({
              type: 'run_failed',
              runId: state.runId,
              at: state.finishedAt,
              error: `task '${failedTask.id}' failed`,
            })
            await saveState(state)
            break
          }

          const pendingTask = [...state.tasks.values()].find(
            (task) =>
              task.status === 'queued' || task.status === 'retrying' || task.status === 'running',
          )
          if (pendingTask) {
            enqueueAllReadyTasks()
            if (queue.length > 0) {
              continue
            }
            state.status = 'failed'
            state.finishedAt = nowIso()
            await emit({
              type: 'run_failed',
              runId: state.runId,
              at: state.finishedAt,
              error: `deadlock while resolving task '${pendingTask.id}'`,
            })
            await saveState(state)
            break
          }

          state.status = 'completed'
          state.finishedAt = nowIso()
          await emit({ type: 'run_completed', runId: state.runId, at: state.finishedAt })
          await saveState(state)
          break
        }

        await Promise.race(running.values())
      }
    } finally {
      activeRuns.delete(state.runId)
    }

    return toRunSummary(snapshotState(state))
  }

  return {
    async run(definition): Promise<RunSummary> {
      const state = buildInitialState(definition)
      return runInternal(state, definition.signal)
    },

    async resume(runId): Promise<RunSummary> {
      const snapshot = await runStore.getRun(runId)
      if (!snapshot) {
        throw new Error(`run '${runId}' not found`)
      }
      if (
        snapshot.status === 'completed' ||
        snapshot.status === 'failed' ||
        snapshot.status === 'cancelled'
      ) {
        return toRunSummary(snapshot)
      }
      const state = restoreState(snapshot)
      return runInternal(state)
    },

    async cancel(runId, reason): Promise<void> {
      const activeRun = activeRuns.get(runId)
      if (!activeRun) {
        const snapshot = await runStore.getRun(runId)
        if (!snapshot) {
          return
        }
        if (
          snapshot.status === 'completed' ||
          snapshot.status === 'failed' ||
          snapshot.status === 'cancelled'
        ) {
          return
        }

        const restored = restoreState(snapshot)
        for (const task of restored.tasks.values()) {
          if (task.status === 'queued' || task.status === 'running' || task.status === 'retrying') {
            task.status = 'cancelled'
            task.errorCode = ORCHESTRATION_ERROR_TASK_CANCELLED
            task.error = reason ?? 'cancelled'
            task.finishedAt = nowIso()
          }
        }
        restored.status = 'cancelled'
        restored.finishedAt = nowIso()
        await emit({
          type: 'run_cancelled',
          runId,
          at: restored.finishedAt,
          reason,
        })
        await saveState(restored)
        return
      }

      activeRun.reasonRef.reason = reason
      activeRun.controller.abort()
    },

    getRun(runId) {
      return runStore.getRun(runId)
    },

    listRuns() {
      return runStore.listRuns()
    },
  }
}

function normalizeRetryPolicy(
  retry: OrchestrationTaskRetryPolicy | undefined,
): Required<OrchestrationTaskRetryPolicy> {
  return {
    retries: Math.max(0, Math.floor(retry?.retries ?? 0)),
    backoffMs: Math.max(0, Math.floor(retry?.backoffMs ?? 0)),
    jitterMs: Math.max(0, Math.floor(retry?.jitterMs ?? 0)),
  }
}

function normalizeTimeout(timeoutMs: number | undefined): number | undefined {
  if (typeof timeoutMs !== 'number') {
    return undefined
  }
  const normalized = Math.max(1, Math.floor(timeoutMs))
  return normalized
}

function shouldRetry(
  policy: Required<OrchestrationTaskRetryPolicy>,
  attemptNumber: number,
): boolean {
  return attemptNumber <= policy.retries
}

function retryDelayMs(
  policy: Required<OrchestrationTaskRetryPolicy>,
  attemptNumber: number,
  random: () => number,
): number {
  const backoff = policy.backoffMs > 0 ? policy.backoffMs * 2 ** Math.max(0, attemptNumber - 1) : 0
  const jitter = policy.jitterMs > 0 ? random() * policy.jitterMs : 0
  return Math.max(0, Math.floor(backoff + jitter))
}

function snapshotState(state: MutableRunState): OrchestrationRunRecord {
  const tasks: Record<string, OrchestrationTaskRecord> = {}
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
    tasks,
    taskOrder: [...state.taskOrder],
    outputs: { ...state.outputs },
    summary,
  }
}

function toRunSummary(snapshot: OrchestrationRunRecord): RunSummary {
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

function taskToDefinition(task: MutableTask): OrchestrationTaskDefinition {
  return {
    id: task.id,
    kind: task.kind,
    input: task.input,
    dependsOn: task.dependsOn,
    retry: task.retry,
    timeoutMs: task.timeoutMs,
    metadata: task.metadata,
  }
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })
}
