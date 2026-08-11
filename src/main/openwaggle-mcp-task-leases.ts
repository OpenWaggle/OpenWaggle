import { randomUUID } from 'node:crypto'
import type { AgentRunResult } from './application/agent-run-service'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import type { OpenWaggleMcpTaskStore, ServerTaskRecord } from './openwaggle-mcp-task-store'

const TASK_LEASE_DURATION_MS = 30_000
const TASK_HEARTBEAT_INTERVAL_MS = 10_000

interface OwnedTaskLease {
  readonly controller: AbortController
  leaseExpiresAt: number
}

export interface OpenWaggleServerTaskLeaseOptions {
  readonly ownerId?: string
  readonly now?: () => number
  readonly leaseDurationMs?: number
  readonly heartbeatIntervalMs?: number
}

export class OpenWaggleTaskLeaseCoordinator {
  readonly ownerId: string
  readonly now: () => number
  private readonly active = new Map<string, OwnedTaskLease>()
  private readonly leaseDurationMs: number
  private readonly heartbeatIntervalMs: number
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined
  private heartbeatOperation: Promise<void> | undefined

  constructor(
    private readonly store: OpenWaggleMcpTaskStore,
    private readonly options: Pick<OpenWaggleMcpServeOptions, 'profile' | 'stderr'>,
    leaseOptions: OpenWaggleServerTaskLeaseOptions,
  ) {
    this.ownerId = leaseOptions.ownerId?.trim() || randomUUID()
    this.now = leaseOptions.now ?? Date.now
    this.leaseDurationMs = leaseOptions.leaseDurationMs ?? TASK_LEASE_DURATION_MS
    this.heartbeatIntervalMs = leaseOptions.heartbeatIntervalMs ?? TASK_HEARTBEAT_INTERVAL_MS
  }

  expiresAt(now: number) {
    return now + this.leaseDurationMs
  }

  register(taskId: string, controller: AbortController, leaseExpiresAt: number) {
    this.active.set(taskId, { controller, leaseExpiresAt })
    this.ensureHeartbeat()
  }

  unregister(taskId: string) {
    this.active.delete(taskId)
    if (this.active.size > 0 || !this.heartbeatTimer) return
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = undefined
  }

  private ensureHeartbeat() {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {
      void this.refreshOwnedTaskLeases()
    }, this.heartbeatIntervalMs)
    this.heartbeatTimer.unref()
  }

  private refreshOwnedTaskLeases() {
    if (this.heartbeatOperation) return this.heartbeatOperation
    const operation = this.performHeartbeat().finally(() => {
      this.heartbeatOperation = undefined
    })
    this.heartbeatOperation = operation
    return operation
  }

  private async performHeartbeat() {
    if (this.active.size === 0) return
    const now = this.now()
    const expiresAt = this.expiresAt(now)
    try {
      const result = await this.store.update((tasks) => {
        const renewed: string[] = []
        const cancelled: string[] = []
        const lost: string[] = []
        const next = tasks.map((task) => {
          if (!this.active.has(task.id)) return task
          if (
            task.callerProfile !== this.options.profile ||
            task.lease?.ownerId !== this.ownerId ||
            !isActiveTaskStatus(task.status)
          ) {
            lost.push(task.id)
            return task
          }
          renewed.push(task.id)
          if (task.cancellationRequestedAt !== undefined) cancelled.push(task.id)
          return { ...task, lease: { ownerId: this.ownerId, expiresAt } }
        })
        return { tasks: next, result: { renewed, cancelled, lost } }
      })
      for (const taskId of result.renewed) {
        const active = this.active.get(taskId)
        if (active) active.leaseExpiresAt = expiresAt
      }
      for (const taskId of [...result.cancelled, ...result.lost]) {
        this.active.get(taskId)?.controller.abort()
      }
    } catch (error) {
      this.options.stderr?.write(
        `OpenWaggle MCP task lease renewal failed: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      for (const task of this.active.values()) {
        if (now >= task.leaseExpiresAt) task.controller.abort()
      }
    }
  }
}

export function isActiveTaskStatus(status: ServerTaskRecord['status']) {
  return status === 'queued' || status === 'working'
}

export function hasLiveLease(task: ServerTaskRecord, now: number) {
  return Boolean(task.lease && task.lease.expiresAt > now)
}

export function recoverStaleTask(task: ServerTaskRecord, now: number): ServerTaskRecord {
  if (!isActiveTaskStatus(task.status) || hasLiveLease(task, now)) return task
  if (task.cancellationRequestedAt !== undefined) return cancelledTaskRecord(task, now)
  return {
    ...task,
    status: 'interrupted',
    lease: null,
    updatedAt: now,
    error: 'The owning OpenWaggle MCP server stopped before this task reached a terminal state.',
    action:
      'The task lease expired. Inspect the linked session, then start a replacement task if more work is required.',
  }
}

export function cancellationRequestedTaskRecord(
  current: ServerTaskRecord,
  now: number,
): ServerTaskRecord {
  return {
    ...current,
    cancellationRequestedAt: current.cancellationRequestedAt ?? now,
    updatedAt: now,
    action:
      'Cancellation was requested. The owning MCP server will stop the agent and record a terminal result; wait or inspect this task again.',
  }
}

export function cancelledTaskRecord(current: ServerTaskRecord, now: number): ServerTaskRecord {
  return {
    ...current,
    status: 'cancelled',
    lease: null,
    error: 'Cancelled by the caller.',
    action: 'No further action is required unless you want to start a replacement task.',
    updatedAt: now,
  }
}

export function terminalTaskRecord(
  current: ServerTaskRecord,
  result: AgentRunResult,
  now: number,
): ServerTaskRecord {
  if (result.outcome === 'success') {
    return {
      ...current,
      status: 'completed',
      lease: null,
      result: { outcome: result.outcome, messages: result.newMessages },
      ...(current.cancellationRequestedAt === undefined
        ? {}
        : { action: 'The task completed before the cancellation request took effect.' }),
      updatedAt: now,
    }
  }
  if (result.outcome === 'aborted') return cancelledTaskRecord(current, now)
  return {
    ...current,
    status: 'failed',
    lease: null,
    error: result.message,
    action:
      'Open the linked OpenWaggle session to inspect the failure and complete any required user action.',
    updatedAt: now,
  }
}
