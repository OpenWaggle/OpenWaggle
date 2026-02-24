import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import {
  orchestrationRunRecordSchema,
  type orchestrationTaskRecordSchema,
  persistedRunIndexSchema,
} from '@shared/schemas/validation'
import { ConversationId, OrchestrationRunId, OrchestrationTaskId } from '@shared/types/brand'
import type { OrchestrationRunRecord, OrchestrationTaskRecord } from '@shared/types/orchestration'
import { parseJsonSafe } from '@shared/utils/parse-json'
import { app } from 'electron'
import { z } from 'zod'
import type { OrchestrationRunRecord as CoreRunRecord, RunStore } from './engine'

interface PersistedRunIndex {
  readonly ids: string[]
}

const INDEX_FILE = 'index.json'
const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/
let indexUpdateQueue: Promise<void> = Promise.resolve()

function getRunsDir(): string {
  const dir = path.join(app.getPath('userData'), 'orchestration-runs')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function runPath(runId: string): string {
  const safeRunId = normalizeRunId(runId)
  if (!safeRunId) {
    throw new Error(`invalid run id: ${runId}`)
  }
  return path.join(getRunsDir(), `${safeRunId}.json`)
}

function indexPath(): string {
  return path.join(getRunsDir(), INDEX_FILE)
}

const taskInputSchema = z.object({ title: z.string() })

function extractTaskTitle(task: CoreRunRecord['tasks'][string]): string | undefined {
  const result = taskInputSchema.safeParse(task.input)
  return result.success ? result.data.title : undefined
}

function toSharedTaskRecord(
  task: CoreRunRecord['tasks'][string],
  createdOrder: number,
): OrchestrationTaskRecord {
  return {
    id: OrchestrationTaskId(task.id),
    kind: task.kind,
    status: task.status,
    dependsOn: task.dependsOn.map((dep) => OrchestrationTaskId(dep)),
    title: extractTaskTitle(task),
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    errorCode: task.errorCode,
    error: task.error,
    retry: task.retry,
    attempts: task.attempts,
    createdOrder: createdOrder,
  }
}

function toSharedRunRecord(
  core: CoreRunRecord,
  conversationId: ConversationId,
  fallbackUsed: boolean,
  fallbackReason?: string,
): OrchestrationRunRecord {
  const tasks: Record<string, OrchestrationTaskRecord> = {}
  for (let i = 0; i < core.taskOrder.length; i++) {
    const taskId = core.taskOrder[i]
    const task = core.tasks[taskId]
    if (!task) continue
    tasks[taskId] = toSharedTaskRecord(task, task.createdOrder ?? i)
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

function toBrandedTaskRecord(
  plain: z.infer<typeof orchestrationTaskRecordSchema>,
): OrchestrationTaskRecord {
  return {
    ...plain,
    id: OrchestrationTaskId(plain.id),
    dependsOn: plain.dependsOn.map(OrchestrationTaskId),
  }
}

function toBrandedRunRecord(
  plain: z.infer<typeof orchestrationRunRecordSchema>,
): OrchestrationRunRecord {
  return {
    ...plain,
    runId: OrchestrationRunId(plain.runId),
    conversationId: ConversationId(plain.conversationId),
    taskOrder: plain.taskOrder.map(OrchestrationTaskId),
    tasks: Object.fromEntries(
      Object.entries(plain.tasks).map(([key, task]) => [key, toBrandedTaskRecord(task)]),
    ),
  }
}

async function readRun(runId: string): Promise<OrchestrationRunRecord | null> {
  try {
    const raw = await fsPromises.readFile(runPath(runId), 'utf-8')
    const result = parseJsonSafe(raw, orchestrationRunRecordSchema)
    return result.success ? toBrandedRunRecord(result.data) : null
  } catch {
    return null
  }
}

async function readIndex(): Promise<PersistedRunIndex> {
  try {
    const raw = await fsPromises.readFile(indexPath(), 'utf-8')
    const result = parseJsonSafe(raw, persistedRunIndexSchema)
    return result.success ? result.data : { ids: [] }
  } catch {
    return { ids: [] }
  }
}

async function writeIndex(next: PersistedRunIndex): Promise<void> {
  await fsPromises.writeFile(indexPath(), JSON.stringify(next, null, 2), 'utf-8')
}

async function upsertIndex(runId: string): Promise<void> {
  const safeRunId = normalizeRunId(runId)
  if (!safeRunId) {
    return
  }
  await queueIndexUpdate(async () => {
    const idx = await readIndex()
    if (idx.ids.includes(safeRunId)) {
      return
    }
    await writeIndex({ ids: [safeRunId, ...idx.ids] })
  })
}

async function queueIndexUpdate(fn: () => Promise<void>): Promise<void> {
  const previous = indexUpdateQueue
  let releaseCurrent: (() => void) | undefined
  indexUpdateQueue = new Promise<void>((resolve) => {
    releaseCurrent = () => resolve()
  })

  await previous.catch(() => {})
  try {
    await fn()
  } finally {
    releaseCurrent?.()
  }
}

function normalizeRunId(runId: string): string | null {
  const trimmed = runId.trim()
  if (!trimmed) {
    return null
  }
  return RUN_ID_PATTERN.test(trimmed) ? trimmed : null
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

    for (let i = 0; i < run.taskOrder.length; i++) {
      const taskId = run.taskOrder[i]
      const key = String(taskId)
      const task = run.tasks[key]
      if (!task) continue
      tasks[key] = {
        id: key,
        kind: task.kind,
        dependsOn: task.dependsOn.map((dep) => String(dep)),
        status: task.status,
        retry: task.retry ?? { retries: 0, backoffMs: 0, jitterMs: 0 },
        attempts: task.attempts ? [...task.attempts] : [],
        createdOrder: task.createdOrder ?? i,
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
