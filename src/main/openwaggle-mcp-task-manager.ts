import { SessionId } from '@shared/types/brand'
import type { ThinkingLevel } from '@shared/types/settings'
import { Effect } from 'effect'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import type { OpenWaggleMcpSessionMetadataStore } from './openwaggle-mcp-session-metadata-store'
import { admitOpenWaggleTask, type OpenWaggleTaskStartInput } from './openwaggle-mcp-task-admission'
import { cancelOpenWaggleSessionTasks } from './openwaggle-mcp-task-cancellation'
import {
  cancellationRequestedTaskRecord,
  cancelledTaskRecord,
  hasLiveLease,
  isActiveTaskStatus,
  type OpenWaggleServerTaskLeaseOptions,
  OpenWaggleTaskLeaseCoordinator,
  terminalTaskRecord,
} from './openwaggle-mcp-task-leases'
import {
  establishTaskLineage,
  projectTaskDelegationState,
  terminalDelegationState,
} from './openwaggle-mcp-task-lineage'
import { reconcileOpenWaggleProfileTasks } from './openwaggle-mcp-task-reconciliation'
import { type ActiveServerTask, taskResult } from './openwaggle-mcp-task-result'
import {
  defaultTaskServices,
  type OpenWaggleServerTaskServices,
} from './openwaggle-mcp-task-runtime'
import { OpenWaggleMcpTaskStore, type ServerTaskRecord } from './openwaggle-mcp-task-store'

export type { OpenWaggleServerTaskLeaseOptions } from './openwaggle-mcp-task-leases'
export type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'

const TASK_WAIT_POLL_INTERVAL_MS = 100

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
    return reconcileOpenWaggleProfileTasks({
      now: this.leases.now(),
      profile: this.options.profile,
      services: this.services,
      store: this.store,
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
    let linkedSessionId: SessionId | null = null
    try {
      const { sessionId, created } = await this.services.createOrReuseSession(task)
      linkedSessionId = sessionId
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
        await establishTaskLineage(this.services, task, sessionId)
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
        await projectTaskDelegationState(this.services, sessionId, 'cancelled')
        return
      }
      if (!created) {
        await projectTaskDelegationState(this.services, sessionId, 'working')
      }
      const result = await this.services.execute({
        sessionId,
        runId: task.id,
        objective: task.objective,
        thinkingLevel,
        model: task.model,
        signal: abort.signal,
      })
      const terminal = await this.mutateOwned(task.id, (current) =>
        abort.signal.aborted
          ? cancelledTaskRecord(current, this.leases.now())
          : terminalTaskRecord(current, result, this.leases.now()),
      )
      if (terminal) {
        await projectTaskDelegationState(
          this.services,
          sessionId,
          terminalDelegationState(terminal.status),
        )
      }
    } catch (error) {
      const failed = await this.mutateOwned(task.id, (current) =>
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
      if (linkedSessionId && failed) {
        await projectTaskDelegationState(
          this.services,
          linkedSessionId,
          terminalDelegationState(failed.status),
        )
      }
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
      const cancelledSessionId =
        next.status === 'cancelled' && next.sessionId ? SessionId(next.sessionId) : null
      if (cancelledSessionId) {
        yield* Effect.promise(() =>
          projectTaskDelegationState(this.services, cancelledSessionId, 'cancelled'),
        )
      }
      return taskResult(next)
    })
  }

  cancelSession(sessionId: string) {
    return Effect.promise(() =>
      cancelOpenWaggleSessionTasks({
        abortTask: (taskId) => this.active.get(taskId)?.controller.abort(),
        now: this.leases.now(),
        profile: this.options.profile,
        services: this.services,
        sessionId,
        store: this.store,
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
