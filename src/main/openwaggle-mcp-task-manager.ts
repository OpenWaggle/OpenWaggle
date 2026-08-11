import { randomUUID } from 'node:crypto'
import { MCP_CONFIG } from '@shared/constants/mcp'
import type { ThinkingLevel } from '@shared/types/settings'
import type { AgentRunResult } from './application/agent-run-service'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import type { OpenWaggleMcpSessionMetadataStore } from './openwaggle-mcp-session-metadata-store'
import {
  defaultTaskServices,
  type OpenWaggleServerTaskServices,
} from './openwaggle-mcp-task-runtime'
import { OpenWaggleMcpTaskStore, type ServerTaskRecord } from './openwaggle-mcp-task-store'

export type { OpenWaggleServerTaskServices } from './openwaggle-mcp-task-runtime'

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
  }
}

export class OpenWaggleServerTaskManager {
  private readonly active = new Map<
    string,
    {
      readonly controller: AbortController
      sessionId?: string
      completion?: Promise<void>
    }
  >()
  private readonly store: OpenWaggleMcpTaskStore

  constructor(
    private readonly options: OpenWaggleMcpServeOptions,
    private readonly sessionMetadata: OpenWaggleMcpSessionMetadataStore,
    private readonly services: OpenWaggleServerTaskServices = defaultTaskServices,
  ) {
    this.store = new OpenWaggleMcpTaskStore(options.taskStorePath)
  }

  async recoverInterruptedTasks() {
    await this.store.update((tasks) => ({
      tasks: tasks.map((task) =>
        task.status === 'queued' || task.status === 'working'
          ? {
              ...task,
              status: 'interrupted',
              updatedAt: Date.now(),
              error: 'The OpenWaggle MCP server stopped before this task reached a terminal state.',
              action: 'Inspect the linked session, then start a new task if more work is required.',
            }
          : task,
      ),
      result: true,
    }))
  }

  private async mutate(taskId: string, update: (current: ServerTaskRecord) => ServerTaskRecord) {
    return this.store.update((tasks) => {
      const current = tasks.find((task) => task.id === taskId)
      if (!current) throw new Error(`OpenWaggle task ${JSON.stringify(taskId)} was not found.`)
      const next = update(current)
      return { tasks: tasks.map((task) => (task.id === taskId ? next : task)), result: next }
    })
  }

  async list() {
    const results: ReturnType<typeof taskResult>[] = []
    for (const task of await this.store.readTasks()) {
      if (task.callerProfile === this.options.profile) results.push(taskResult(task))
    }
    return results
  }

  async get(taskId: string) {
    const task = (await this.store.readTasks()).find(
      (candidate) => candidate.id === taskId && candidate.callerProfile === this.options.profile,
    )
    if (!task) throw new Error(`OpenWaggle task ${JSON.stringify(taskId)} was not found.`)
    return taskResult(task)
  }

  async listForSession(sessionId: string) {
    return (await this.list()).filter((task) => task.sessionId === sessionId)
  }

  hasActiveSessionTask(sessionId: string) {
    return [...this.active.values()].some((task) => task.sessionId === sessionId)
  }

  async getExecutionProfile(sessionId: string) {
    return this.services.resolveExecutionProfile(sessionId)
  }

  async start(input: {
    readonly projectPath: string
    readonly objective: string
    readonly sessionId?: string
  }) {
    if (input.sessionId && input.sessionId === this.options.originSessionId) {
      throw new Error('The caller profile cannot target its own origin session.')
    }
    if (this.active.size >= MCP_CONFIG.MAX_SESSION_FAN_OUT) {
      throw new Error(
        `The caller profile already has ${MCP_CONFIG.MAX_SESSION_FAN_OUT} active session tasks. Wait for or interrupt one before starting another.`,
      )
    }
    if (input.sessionId && this.hasActiveSessionTask(input.sessionId)) {
      throw new Error('The target session already has an active hosted task.')
    }
    const delegationDepth = (await this.sessionMetadata.depth(this.options.originSessionId)) + 1
    if (delegationDepth > MCP_CONFIG.MAX_ORCHESTRATION_DEPTH) {
      throw new Error(
        `The task would exceed the maximum hosted session depth of ${MCP_CONFIG.MAX_ORCHESTRATION_DEPTH}.`,
      )
    }
    const executionProfile = await this.services.resolveExecutionProfile(input.sessionId)
    const task: ServerTaskRecord = {
      id: randomUUID(),
      callerProfile: this.options.profile,
      projectPath: input.projectPath,
      model: executionProfile.model,
      objective: input.objective,
      delegationDepth,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }
    await this.store.update((tasks) => ({ tasks: [task, ...tasks], result: true }))
    const abortController = new AbortController()
    const activeTask: {
      readonly controller: AbortController
      sessionId?: string
      completion?: Promise<void>
    } = { controller: abortController, ...(input.sessionId ? { sessionId: input.sessionId } : {}) }
    this.active.set(task.id, activeTask)
    activeTask.completion = this.run(task, executionProfile.thinkingLevel, abortController).finally(
      () => this.active.delete(task.id),
    )
    return taskResult(task)
  }

  private async run(task: ServerTaskRecord, thinkingLevel: ThinkingLevel, abort: AbortController) {
    try {
      const { sessionId, created } = await this.services.createOrReuseSession(task)
      const activeTask = this.active.get(task.id)
      if (activeTask) activeTask.sessionId = sessionId
      if (created) await this.sessionMetadata.setDepth(sessionId, task.delegationDepth ?? 0)
      if (abort.signal.aborted) throw new Error('The hosted task was cancelled before execution.')
      await this.mutate(task.id, (current) => ({
        ...current,
        sessionId,
        status: 'working',
        updatedAt: Date.now(),
      }))
      const result = await this.services.execute({
        sessionId,
        runId: task.id,
        objective: task.objective,
        thinkingLevel,
        model: task.model,
        signal: abort.signal,
      })
      await this.mutate(task.id, (current) =>
        abort.signal.aborted ? cancelledTaskRecord(current) : terminalTaskRecord(current, result),
      )
    } catch (error) {
      await this.mutate(task.id, (current) =>
        abort.signal.aborted
          ? cancelledTaskRecord(current)
          : {
              ...current,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
              action:
                'Inspect the linked session and OpenWaggle logs, correct the problem, then retry.',
              updatedAt: Date.now(),
            },
      ).catch(() => undefined)
    }
  }

  async cancel(taskId: string) {
    const current = await this.get(taskId)
    if (['completed', 'failed', 'cancelled', 'interrupted'].includes(current.status)) return current
    this.active.get(taskId)?.controller.abort()
    return taskResult(await this.mutate(taskId, cancelledTaskRecord))
  }

  async cancelSession(sessionId: string) {
    const matching = [...this.active.entries()].filter(([, task]) => task.sessionId === sessionId)
    for (const [, task] of matching) task.controller.abort()
    await Promise.allSettled(matching.map(([taskId]) => this.mutate(taskId, cancelledTaskRecord)))
    return matching.length
  }

  async waitForSession(sessionId: string, timeoutMs: number) {
    const completions = [...this.active.values()].flatMap((task) =>
      task.sessionId === sessionId && task.completion ? [task.completion] : [],
    )
    if (completions.length === 0) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })
    const completed = Promise.allSettled(completions).then(() => true as const)
    const result = await Promise.race([completed, timedOut])
    if (timer) clearTimeout(timer)
    return result
  }

  async cancelAll() {
    const completions = [...this.active.values()].flatMap((task) =>
      task.completion ? [task.completion] : [],
    )
    for (const task of this.active.values()) task.controller.abort()
    await Promise.allSettled(completions)
  }
}

function cancelledTaskRecord(current: ServerTaskRecord): ServerTaskRecord {
  return {
    ...current,
    status: 'cancelled',
    error: 'Cancelled by the caller.',
    action: 'No further action is required unless you want to start a replacement task.',
    updatedAt: Date.now(),
  }
}

function terminalTaskRecord(current: ServerTaskRecord, result: AgentRunResult): ServerTaskRecord {
  if (result.outcome === 'success') {
    return {
      ...current,
      status: 'completed',
      result: { outcome: result.outcome, messages: result.newMessages },
      updatedAt: Date.now(),
    }
  }
  if (result.outcome === 'aborted')
    return { ...current, status: 'cancelled', updatedAt: Date.now() }
  return {
    ...current,
    status: 'failed',
    error: result.message,
    action:
      'Open the linked OpenWaggle session to inspect the failure and complete any required user action.',
    updatedAt: Date.now(),
  }
}
