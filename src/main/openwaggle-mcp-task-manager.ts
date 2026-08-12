import type { ThinkingLevel } from '@shared/types/settings'
import { Effect } from 'effect'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import type { OpenWaggleMcpSessionMetadataStore } from './openwaggle-mcp-session-metadata-store'
import { admitOpenWaggleTask, type OpenWaggleTaskStartInput } from './openwaggle-mcp-task-admission'
import {
  cancellationRequestedTaskRecord,
  cancelledTaskRecord,
  hasLiveLease,
  isActiveTaskStatus,
  type OpenWaggleServerTaskLeaseOptions,
  OpenWaggleTaskLeaseCoordinator,
  recoverStaleTask,
  terminalTaskRecord,
} from './openwaggle-mcp-task-leases'
import {
  defaultTaskServices,
  type OpenWaggleServerTaskServices,
} from './openwaggle-mcp-task-runtime'
import { OpenWaggleMcpTaskStore, type ServerTaskRecord } from './openwaggle-mcp-task-store'

export type { OpenWaggleServerTaskLeaseOptions } from './openwaggle-mcp-task-leases'
export type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'

const TASK_WAIT_POLL_INTERVAL_MS = 100

interface ActiveServerTask {
  readonly controller: AbortController
  sessionId?: string
  completion?: Promise<void>
}

function taskResult(record: ServerTaskRecord) {
  return {
    id: record.id,
    status: record.status,
    projectPath: record.projectPath,
    model: record.model,
    delegationDepth: record.delegationDepth ?? 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.sessionId ? { sessionId: record.sessionId } : {}),
    ...(record.result === undefined ? {} : { result: record.result }),
    ...(record.error ? { error: record.error } : {}),
    ...(record.action ? { action: record.action } : {}),
    ...(record.cancellationRequestedAt === undefined
      ? {}
      : { cancellationRequestedAt: record.cancellationRequestedAt }),
  }
}

export class OpenWaggleServerTaskManager {
  private readonly active = new Map<string, ActiveServerTask>()
  private readonly leases: OpenWaggleTaskLeaseCoordinator
  private readonly store: OpenWaggleMcpTaskStore

  constructor(
    private readonly options: OpenWaggleMcpServeOptions,
    private readonly sessionMetadata: OpenWaggleMcpSessionMetadataStore,
    private readonly services: OpenWaggleServerTaskServices = defaultTaskServices,
    leaseOptions: OpenWaggleServerTaskLeaseOptions = {},
  ) {
    this.store = new OpenWaggleMcpTaskStore(options.taskStorePath)
    this.leases = new OpenWaggleTaskLeaseCoordinator(this.store, options, leaseOptions)
  }

  recoverInterruptedTasks() {
    return Effect.promise(() => this.reconcileProfileTasks()).pipe(Effect.asVoid)
  }

  private async mutate(taskId: string, update: (current: ServerTaskRecord) => ServerTaskRecord) {
    return this.store.update((tasks) => {
      const current = tasks.find(
        (task) => task.id === taskId && task.callerProfile === this.options.profile,
      )
      if (!current) throw new Error(`OpenWaggle task ${JSON.stringify(taskId)} was not found.`)
      const next = update(current)
      return { tasks: tasks.map((task) => (task.id === taskId ? next : task)), result: next }
    })
  }

  private async mutateOwned(
    taskId: string,
    update: (current: ServerTaskRecord) => ServerTaskRecord,
  ) {
    return this.store.update((tasks) => {
      const current = tasks.find(
        (task) => task.id === taskId && task.callerProfile === this.options.profile,
      )
      if (!current) throw new Error(`OpenWaggle task ${JSON.stringify(taskId)} was not found.`)
      if (current.lease?.ownerId !== this.leases.ownerId || !isActiveTaskStatus(current.status)) {
        return { tasks, result: null }
      }
      const next = update(current)
      return { tasks: tasks.map((task) => (task.id === taskId ? next : task)), result: next }
    })
  }

  private reconcileProfileTasks() {
    const now = this.leases.now()
    return this.store.update((tasks) => {
      const reconciled = tasks.map((task) =>
        task.callerProfile === this.options.profile ? recoverStaleTask(task, now) : task,
      )
      return { tasks: reconciled, result: reconciled }
    })
  }

  list() {
    return Effect.promise(() => this.reconcileProfileTasks()).pipe(
      Effect.map((tasks) =>
        tasks.flatMap((task) =>
          task.callerProfile === this.options.profile ? [taskResult(task)] : [],
        ),
      ),
    )
  }

  get(taskId: string) {
    return Effect.gen(this, function* () {
      const task = (yield* Effect.promise(() => this.reconcileProfileTasks())).find(
        (candidate) => candidate.id === taskId && candidate.callerProfile === this.options.profile,
      )
      if (!task)
        return yield* Effect.fail(
          new Error(`OpenWaggle task ${JSON.stringify(taskId)} was not found.`),
        )
      return taskResult(task)
    })
  }

  listForSession(sessionId: string) {
    return this.list().pipe(
      Effect.map((tasks) => tasks.filter((task) => task.sessionId === sessionId)),
    )
  }

  hasActiveSessionTask(sessionId: string) {
    return [...this.active.values()].some((task) => task.sessionId === sessionId)
  }

  getExecutionProfile(sessionId: string) {
    return Effect.promise(() => this.services.resolveExecutionProfile(sessionId))
  }

  start(input: OpenWaggleTaskStartInput) {
    return Effect.promise(() =>
      admitOpenWaggleTask({
        input,
        leases: this.leases,
        options: this.options,
        services: this.services,
        sessionMetadata: this.sessionMetadata,
        store: this.store,
      }),
    ).pipe(
      Effect.map(({ executionProfile, leaseExpiresAt, task }) => {
        const abortController = new AbortController()
        const activeTask: ActiveServerTask = {
          controller: abortController,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        }
        this.active.set(task.id, activeTask)
        this.leases.register(task.id, abortController, leaseExpiresAt)
        activeTask.completion = this.run(
          task,
          executionProfile.thinkingLevel,
          abortController,
        ).finally(() => {
          this.active.delete(task.id)
          this.leases.unregister(task.id)
        })
        return taskResult(task)
      }),
    )
  }

  private async run(task: ServerTaskRecord, thinkingLevel: ThinkingLevel, abort: AbortController) {
    try {
      const { sessionId, created } = await this.services.createOrReuseSession(task)
      const activeTask = this.active.get(task.id)
      if (activeTask) activeTask.sessionId = sessionId
      if (created) {
        await this.sessionMetadata.update(sessionId, (current) => ({
          ...current,
          depth: task.delegationDepth ?? 0,
          ownedSession: {
            profile: this.options.profile,
            projectPath: task.projectPath,
            createdAt: this.leases.now(),
          },
          updatedAt: this.leases.now(),
        }))
      }
      if (abort.signal.aborted) throw new Error('The hosted task was cancelled before execution.')
      const working = await this.mutateOwned(task.id, (current) =>
        current.cancellationRequestedAt === undefined
          ? {
              ...current,
              sessionId,
              status: 'working',
              updatedAt: this.leases.now(),
            }
          : cancelledTaskRecord(current, this.leases.now()),
      )
      if (working?.status !== 'working') {
        abort.abort()
        return
      }
      const result = await this.services.execute({
        sessionId,
        runId: task.id,
        objective: task.objective,
        thinkingLevel,
        model: task.model,
        signal: abort.signal,
      })
      await this.mutateOwned(task.id, (current) =>
        abort.signal.aborted
          ? cancelledTaskRecord(current, this.leases.now())
          : terminalTaskRecord(current, result, this.leases.now()),
      )
    } catch (error) {
      await this.mutateOwned(task.id, (current) =>
        abort.signal.aborted
          ? cancelledTaskRecord(current, this.leases.now())
          : {
              ...current,
              status: 'failed',
              lease: null,
              error: error instanceof Error ? error.message : String(error),
              action:
                'Inspect the linked session and OpenWaggle logs, correct the problem, then retry.',
              updatedAt: this.leases.now(),
            },
      ).catch(() => undefined)
    }
  }

  cancel(taskId: string) {
    return Effect.gen(this, function* () {
      const now = this.leases.now()
      const next = yield* Effect.promise(() =>
        this.mutate(taskId, (current) => {
          if (!isActiveTaskStatus(current.status)) return current
          return hasLiveLease(current, now)
            ? cancellationRequestedTaskRecord(current, now)
            : cancelledTaskRecord(current, now)
        }),
      )
      this.active.get(taskId)?.controller.abort()
      return taskResult(next)
    })
  }

  cancelSession(sessionId: string) {
    const now = this.leases.now()
    return Effect.promise(() =>
      this.store.update((tasks) => {
        const matching = tasks.filter(
          (task) =>
            task.callerProfile === this.options.profile &&
            task.sessionId === sessionId &&
            isActiveTaskStatus(task.status),
        )
        const matchingIds = new Set(matching.map((task) => task.id))
        return {
          tasks: tasks.map((task) =>
            matchingIds.has(task.id)
              ? hasLiveLease(task, now)
                ? cancellationRequestedTaskRecord(task, now)
                : cancelledTaskRecord(task, now)
              : task,
          ),
          result: [...matchingIds],
        }
      }),
    ).pipe(
      Effect.map((taskIds) => {
        for (const taskId of taskIds) this.active.get(taskId)?.controller.abort()
        return taskIds.length
      }),
    )
  }

  waitForSession(sessionId: string, timeoutMs: number) {
    return Effect.gen(this, function* () {
      const deadline = this.leases.now() + timeoutMs
      while (true) {
        const tasks = yield* Effect.promise(() => this.reconcileProfileTasks())
        const active = tasks.some(
          (task) =>
            task.callerProfile === this.options.profile &&
            task.sessionId === sessionId &&
            isActiveTaskStatus(task.status) &&
            hasLiveLease(task, this.leases.now()),
        )
        if (!active) return true
        const remaining = deadline - this.leases.now()
        if (remaining <= 0) return false
        yield* Effect.sleep(`${Math.min(TASK_WAIT_POLL_INTERVAL_MS, remaining)} millis`)
      }
    })
  }

  cancelAll() {
    return Effect.promise(async () => {
      const completions = [...this.active.values()].flatMap((task) =>
        task.completion ? [task.completion] : [],
      )
      for (const task of this.active.values()) task.controller.abort()
      await Promise.allSettled(completions)
      await this.leases.close()
    })
  }
}
