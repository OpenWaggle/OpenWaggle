import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { type ConversationId, OrchestrationRunId, OrchestrationTaskId } from '@shared/types/brand'
import type { OrchestrationRunRecord, OrchestrationTaskRecord } from '@shared/types/orchestration'
import type { OrchestrationRunRecord as CoreRunRecord, RunStore } from 'condukt-ai'
import { app } from 'electron'

interface PersistedRunIndex {
  readonly ids: string[]
}

const INDEX_FILE = 'index.json'

function getRunsDir(): string {
  const dir = path.join(app.getPath('userData'), 'orchestration-runs')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function runPath(runId: string): string {
  return path.join(getRunsDir(), `${runId}.json`)
}

function indexPath(): string {
  return path.join(getRunsDir(), INDEX_FILE)
}

function toSharedTaskRecord(task: CoreRunRecord['tasks'][string]): OrchestrationTaskRecord {
  return {
    id: OrchestrationTaskId(task.id),
    kind: task.kind,
    status: task.status,
    dependsOn: task.dependsOn.map((dep) => OrchestrationTaskId(dep)),
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    errorCode: task.errorCode,
    error: task.error,
  }
}

function toSharedRunRecord(
  core: CoreRunRecord,
  conversationId: ConversationId,
  fallbackUsed: boolean,
  fallbackReason?: string,
): OrchestrationRunRecord {
  const tasks: Record<string, OrchestrationTaskRecord> = {}
  for (const taskId of core.taskOrder) {
    const task = core.tasks[taskId]
    if (!task) continue
    tasks[taskId] = toSharedTaskRecord(task)
  }

  return {
    runId: OrchestrationRunId(core.runId),
    conversationId,
    status: core.status,
    startedAt: core.startedAt,
    finishedAt: core.finishedAt,
    taskOrder: core.taskOrder.map((taskId) => OrchestrationTaskId(taskId)),
    tasks,
    outputs: core.outputs,
    fallbackUsed,
    fallbackReason,
    updatedAt: Date.now(),
  }
}

async function readRun(runId: string): Promise<OrchestrationRunRecord | null> {
  try {
    const raw = await fsPromises.readFile(runPath(runId), 'utf-8')
    return JSON.parse(raw) as OrchestrationRunRecord
  } catch {
    return null
  }
}

async function readIndex(): Promise<PersistedRunIndex> {
  try {
    const raw = await fsPromises.readFile(indexPath(), 'utf-8')
    const parsed = JSON.parse(raw) as PersistedRunIndex
    return Array.isArray(parsed.ids) ? parsed : { ids: [] }
  } catch {
    return { ids: [] }
  }
}

async function writeIndex(next: PersistedRunIndex): Promise<void> {
  await fsPromises.writeFile(indexPath(), JSON.stringify(next, null, 2), 'utf-8')
}

async function upsertIndex(runId: string): Promise<void> {
  const idx = await readIndex()
  if (idx.ids.includes(runId)) {
    return
  }
  await writeIndex({ ids: [runId, ...idx.ids] })
}

export class OrchestrationRunRepository {
  createRunStore(
    conversationId: ConversationId,
    fallbackState: { used: boolean; reason?: string },
  ): RunStore {
    return {
      saveRun: async (run) => {
        const shared = toSharedRunRecord(
          run,
          conversationId,
          fallbackState.used,
          fallbackState.reason,
        )
        await this.save(shared)
      },
      getRun: async (runId) => {
        const shared = await this.get(runId)
        if (!shared) return null
        return this.toCore(shared)
      },
      listRuns: async () => {
        const runs = await this.list(conversationId)
        return runs.map((run) => this.toCore(run))
      },
    }
  }

  async save(run: OrchestrationRunRecord): Promise<void> {
    await fsPromises.writeFile(runPath(String(run.runId)), JSON.stringify(run, null, 2), 'utf-8')
    await upsertIndex(String(run.runId))
  }

  async get(runId: string): Promise<OrchestrationRunRecord | null> {
    return readRun(runId)
  }

  async list(conversationId?: ConversationId): Promise<OrchestrationRunRecord[]> {
    const idx = await readIndex()
    const runs: OrchestrationRunRecord[] = []

    for (const runId of idx.ids) {
      const run = await readRun(runId)
      if (!run) continue
      if (conversationId && run.conversationId !== conversationId) continue
      runs.push(run)
    }

    return runs.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async markFallback(runId: string, reason?: string): Promise<void> {
    const current = await this.get(runId)
    if (!current) return

    const next: OrchestrationRunRecord = {
      ...current,
      fallbackUsed: true,
      fallbackReason: reason,
      updatedAt: Date.now(),
    }
    await this.save(next)
  }

  async markCancelled(runId: string, reason?: string): Promise<void> {
    const current = await this.get(runId)
    if (!current) return

    const tasks: Record<string, OrchestrationTaskRecord> = {}
    for (const taskId of current.taskOrder) {
      const key = String(taskId)
      const task = current.tasks[key]
      if (!task) continue
      tasks[key] =
        task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
          ? task
          : {
              ...task,
              status: 'cancelled',
              errorCode: 'TASK_CANCELLED',
              error: reason ?? 'cancelled',
              finishedAt: new Date().toISOString(),
            }
    }

    const next: OrchestrationRunRecord = {
      ...current,
      status: 'cancelled',
      finishedAt: new Date().toISOString(),
      tasks,
      updatedAt: Date.now(),
    }
    await this.save(next)
  }

  private toCore(run: OrchestrationRunRecord): CoreRunRecord {
    const tasks: Record<string, CoreRunRecord['tasks'][string]> = {}

    for (const taskId of run.taskOrder) {
      const key = String(taskId)
      const task = run.tasks[key]
      if (!task) continue
      tasks[key] = {
        id: key,
        kind: task.kind,
        dependsOn: task.dependsOn.map((dep) => String(dep)),
        status: task.status,
        retry: { retries: 0, backoffMs: 0, jitterMs: 0 },
        attempts: [],
        createdOrder: 0,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        errorCode: task.errorCode,
        error: task.error,
      }
    }

    return {
      runId: String(run.runId),
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      tasks,
      taskOrder: run.taskOrder.map((taskId) => String(taskId)),
      outputs: run.outputs,
      summary: {
        total: run.taskOrder.length,
        completed: Object.values(tasks).filter((task) => task.status === 'completed').length,
        failed: Object.values(tasks).filter((task) => task.status === 'failed').length,
        cancelled: Object.values(tasks).filter((task) => task.status === 'cancelled').length,
        queued: Object.values(tasks).filter((task) => task.status === 'queued').length,
        running: Object.values(tasks).filter((task) => task.status === 'running').length,
        retrying: Object.values(tasks).filter((task) => task.status === 'retrying').length,
      },
    }
  }
}

export const orchestrationRunRepository = new OrchestrationRunRepository()
