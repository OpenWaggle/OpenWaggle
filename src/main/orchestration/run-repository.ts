import { randomUUID } from 'node:crypto'
import * as SqlClient from '@effect/sql/SqlClient'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import {
  jsonObjectSchema,
  jsonValueSchema,
  orchestrationTaskAttemptSchema,
  orchestrationTaskRetryPolicySchema,
} from '@shared/schemas/validation'
import { ConversationId, OrchestrationRunId, OrchestrationTaskId } from '@shared/types/brand'
import type { JsonObject, JsonValue } from '@shared/types/json'
import type {
  OrchestrationOutputValue,
  OrchestrationRunRecord,
  OrchestrationTaskRecord,
} from '@shared/types/orchestration'
import * as Effect from 'effect/Effect'
import { runAppEffect } from '../runtime'
import type {
  OrchestrationRunRecord as CoreRunRecord,
  OrchestrationEvent,
  RunStore,
} from './engine'

interface OrchestrationRunRow {
  readonly run_id: string
  readonly conversation_id: string
  readonly status: OrchestrationRunRecord['status']
  readonly started_at: string
  readonly finished_at: string | null
  readonly max_parallel_tasks: number | null
  readonly task_order_json: string
  readonly outputs_json: string
  readonly fallback_used: number
  readonly fallback_reason: string | null
  readonly updated_at: number
}

interface OrchestrationRunTaskRow {
  readonly run_id: string
  readonly task_id: string
  readonly kind: string
  readonly status: OrchestrationTaskRecord['status']
  readonly depends_on_json: string
  readonly title: string | null
  readonly input_json: string | null
  readonly output_json: string | null
  readonly started_at: string | null
  readonly finished_at: string | null
  readonly error_code: string | null
  readonly error: string | null
  readonly retry_json: string | null
  readonly attempts_json: string | null
  readonly timeout_ms: number | null
  readonly metadata_json: string | null
  readonly created_order: number
}

interface PersistedOrchestrationEventRow {
  readonly sequence: number
  readonly event_type: string
  readonly occurred_at: string
  readonly payload_json: string
  readonly metadata_json: string
}

interface AppendEventInput {
  readonly conversationId: ConversationId
  readonly event: OrchestrationEvent
  readonly actorKind?: string
  readonly commandId?: string
  readonly causationEventId?: string
  readonly correlationId?: string
  readonly metadata?: Readonly<Record<string, JsonValue>>
}

interface SaveRunOptions {
  readonly coreSnapshot?: CoreRunRecord
}

const ORCHESTRATION_AGGREGATE_KIND = 'orchestration_run'
const DEFAULT_ACTOR_KIND = 'system'
const CANCELLED_ERROR_CODE = 'TASK_CANCELLED'
const RUN_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

const taskAttemptsSchema = Schema.mutable(Schema.Array(orchestrationTaskAttemptSchema))
const taskOrderSchema = Schema.mutable(Schema.Array(Schema.String))

function extractTaskTitle(task: CoreRunRecord['tasks'][string]): string | undefined {
  const input = task.input
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined
  }
  const title = input.title
  return typeof title === 'string' && title.trim().length > 0 ? title : undefined
}

function parseJsonString(raw: string | null): unknown | null {
  if (raw === null) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseTaskOrder(raw: string): readonly string[] {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(taskOrderSchema, parsed)
  return result.success ? result.data : []
}

function parseOutputMap(raw: string): Readonly<Record<string, OrchestrationOutputValue>> {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(jsonObjectSchema, parsed)
  return result.success ? result.data : {}
}

function parseJsonValue(raw: string | null): JsonValue | undefined {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(jsonValueSchema, parsed)
  return result.success ? result.data : undefined
}

function parseJsonObject(raw: string | null): Readonly<JsonObject> | undefined {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(jsonObjectSchema, parsed)
  return result.success ? result.data : undefined
}

function parseRetryPolicy(raw: string | null): CoreRunRecord['tasks'][string]['retry'] {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(orchestrationTaskRetryPolicySchema, parsed)
  return result.success
    ? {
        retries: result.data.retries,
        backoffMs: result.data.backoffMs,
        jitterMs: result.data.jitterMs,
      }
    : { retries: 0, backoffMs: 0, jitterMs: 0 }
}

function parseAttempts(
  raw: string | null,
): readonly CoreRunRecord['tasks'][string]['attempts'][number][] {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(taskAttemptsSchema, parsed)
  return result.success ? result.data : []
}

function toSharedTaskRecord(
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

function toSharedRunRecord(
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

function summarizeCoreRun(tasks: Readonly<Record<string, CoreRunRecord['tasks'][string]>>) {
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

function normalizeRunId(runId: string): string | null {
  const trimmed = runId.trim()
  if (!trimmed) {
    return null
  }

  return RUN_ID_PATTERN.test(trimmed) ? trimmed : null
}

function buildCoreTaskFromRow(row: OrchestrationRunTaskRow): CoreRunRecord['tasks'][string] {
  return {
    id: row.task_id,
    kind: row.kind,
    dependsOn: parseTaskOrder(row.depends_on_json),
    input: parseJsonValue(row.input_json),
    output: parseJsonValue(row.output_json),
    status: row.status,
    retry: parseRetryPolicy(row.retry_json),
    timeoutMs: row.timeout_ms ?? undefined,
    attempts: parseAttempts(row.attempts_json),
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    errorCode: row.error_code ?? undefined,
    error: row.error ?? undefined,
    metadata: parseJsonObject(row.metadata_json),
    createdOrder: row.created_order,
  }
}

function buildSharedRunFromRows(
  runRow: OrchestrationRunRow,
  taskRows: readonly OrchestrationRunTaskRow[],
): OrchestrationRunRecord {
  const taskOrder = parseTaskOrder(runRow.task_order_json)
  const tasks: Record<string, OrchestrationTaskRecord> = {}

  for (const taskRow of taskRows) {
    const taskId = taskRow.task_id
    tasks[taskId] = {
      id: OrchestrationTaskId(taskId),
      kind: taskRow.kind,
      status: taskRow.status,
      dependsOn: parseTaskOrder(taskRow.depends_on_json).map((dependencyId) =>
        OrchestrationTaskId(dependencyId),
      ),
      title: taskRow.title ?? undefined,
      startedAt: taskRow.started_at ?? undefined,
      finishedAt: taskRow.finished_at ?? undefined,
      errorCode: taskRow.error_code ?? undefined,
      error: taskRow.error ?? undefined,
      retry: parseRetryPolicy(taskRow.retry_json),
      attempts: parseAttempts(taskRow.attempts_json),
      createdOrder: taskRow.created_order,
    }
  }

  return {
    runId: OrchestrationRunId(runRow.run_id),
    conversationId: ConversationId(runRow.conversation_id),
    status: runRow.status,
    startedAt: runRow.started_at,
    finishedAt: runRow.finished_at ?? undefined,
    maxParallelTasks: runRow.max_parallel_tasks ?? undefined,
    taskOrder: taskOrder.map((taskId) => OrchestrationTaskId(taskId)),
    tasks,
    outputs: parseOutputMap(runRow.outputs_json),
    fallbackUsed: runRow.fallback_used === 1,
    fallbackReason: runRow.fallback_reason ?? undefined,
    updatedAt: runRow.updated_at,
  }
}

function buildCoreRunFromRows(
  runRow: OrchestrationRunRow,
  taskRows: readonly OrchestrationRunTaskRow[],
): CoreRunRecord {
  const taskOrder = parseTaskOrder(runRow.task_order_json)
  const tasks: Record<string, CoreRunRecord['tasks'][string]> = {}

  for (const taskRow of taskRows) {
    tasks[taskRow.task_id] = buildCoreTaskFromRow(taskRow)
  }

  return {
    runId: runRow.run_id,
    status: runRow.status,
    startedAt: runRow.started_at,
    finishedAt: runRow.finished_at ?? undefined,
    maxParallelTasks: runRow.max_parallel_tasks ?? undefined,
    tasks,
    taskOrder,
    outputs: parseOutputMap(runRow.outputs_json),
    summary: summarizeCoreRun(tasks),
  }
}

async function listRunRows(
  conversationId?: ConversationId,
): Promise<readonly OrchestrationRunRow[]> {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      if (conversationId) {
        return yield* sql<OrchestrationRunRow>`
          SELECT
            run_id,
            conversation_id,
            status,
            started_at,
            finished_at,
            max_parallel_tasks,
            task_order_json,
            outputs_json,
            fallback_used,
            fallback_reason,
            updated_at
          FROM orchestration_runs
          WHERE conversation_id = ${conversationId}
          ORDER BY updated_at DESC
        `
      }

      return yield* sql<OrchestrationRunRow>`
        SELECT
          run_id,
          conversation_id,
          status,
          started_at,
          finished_at,
          max_parallel_tasks,
          task_order_json,
          outputs_json,
          fallback_used,
          fallback_reason,
          updated_at
        FROM orchestration_runs
        ORDER BY updated_at DESC
      `
    }),
  )
}

async function getRunRow(runId: string): Promise<OrchestrationRunRow | null> {
  const rows = await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<OrchestrationRunRow>`
        SELECT
          run_id,
          conversation_id,
          status,
          started_at,
          finished_at,
          max_parallel_tasks,
          task_order_json,
          outputs_json,
          fallback_used,
          fallback_reason,
          updated_at
        FROM orchestration_runs
        WHERE run_id = ${runId}
        LIMIT 1
      `
    }),
  )

  return rows[0] ?? null
}

async function listTaskRows(runId: string): Promise<readonly OrchestrationRunTaskRow[]> {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<OrchestrationRunTaskRow>`
        SELECT
          run_id,
          task_id,
          kind,
          status,
          depends_on_json,
          title,
          input_json,
          output_json,
          started_at,
          finished_at,
          error_code,
          error,
          retry_json,
          attempts_json,
          timeout_ms,
          metadata_json,
          created_order
        FROM orchestration_run_tasks
        WHERE run_id = ${runId}
        ORDER BY created_order ASC
      `
    }),
  )
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
        await this.save(shared, { coreSnapshot: run })
      },
      getRun: async (runId) => this.getCore(runId),
      listRuns: async () => this.listCore(conversationId),
    }
  }

  async save(run: OrchestrationRunRecord, options?: SaveRunOptions): Promise<void> {
    const safeRunId = normalizeRunId(String(run.runId))
    if (!safeRunId) {
      throw new Error(`invalid run id: ${String(run.runId)}`)
    }

    const coreSnapshot = options?.coreSnapshot ?? this.toCore(run)

    await runAppEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO orchestration_runs (
                run_id,
                conversation_id,
                status,
                started_at,
                finished_at,
                max_parallel_tasks,
                task_order_json,
                outputs_json,
                fallback_used,
                fallback_reason,
                updated_at
              )
              VALUES (
                ${safeRunId},
                ${run.conversationId},
                ${run.status},
                ${run.startedAt},
                ${run.finishedAt ?? null},
                ${run.maxParallelTasks ?? null},
                ${JSON.stringify(run.taskOrder)},
                ${JSON.stringify(run.outputs)},
                ${run.fallbackUsed ? 1 : 0},
                ${run.fallbackReason ?? null},
                ${run.updatedAt}
              )
              ON CONFLICT(run_id) DO UPDATE SET
                conversation_id = excluded.conversation_id,
                status = excluded.status,
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                max_parallel_tasks = excluded.max_parallel_tasks,
                task_order_json = excluded.task_order_json,
                outputs_json = excluded.outputs_json,
                fallback_used = excluded.fallback_used,
                fallback_reason = excluded.fallback_reason,
                updated_at = excluded.updated_at
            `

            yield* sql`
              DELETE FROM orchestration_run_tasks
              WHERE run_id = ${safeRunId}
            `

            for (const taskId of coreSnapshot.taskOrder) {
              const coreTask = coreSnapshot.tasks[taskId]
              if (!coreTask) {
                continue
              }

              const sharedTask = run.tasks[taskId]
              const taskTitle = sharedTask?.title ?? extractTaskTitle(coreTask)

              yield* sql`
                INSERT INTO orchestration_run_tasks (
                  run_id,
                  task_id,
                  kind,
                  status,
                  depends_on_json,
                  title,
                  input_json,
                  output_json,
                  started_at,
                  finished_at,
                  error_code,
                  error,
                  retry_json,
                  attempts_json,
                  timeout_ms,
                  metadata_json,
                  created_order
                )
                VALUES (
                  ${safeRunId},
                  ${taskId},
                  ${coreTask.kind},
                  ${coreTask.status},
                  ${JSON.stringify(coreTask.dependsOn)},
                  ${taskTitle ?? null},
                  ${typeof coreTask.input === 'undefined' ? null : JSON.stringify(coreTask.input)},
                  ${
                    typeof coreTask.output === 'undefined' ? null : JSON.stringify(coreTask.output)
                  },
                  ${coreTask.startedAt ?? null},
                  ${coreTask.finishedAt ?? null},
                  ${coreTask.errorCode ?? null},
                  ${coreTask.error ?? null},
                  ${JSON.stringify(coreTask.retry)},
                  ${JSON.stringify(coreTask.attempts)},
                  ${coreTask.timeoutMs ?? null},
                  ${
                    typeof coreTask.metadata === 'undefined'
                      ? null
                      : JSON.stringify(coreTask.metadata)
                  },
                  ${coreTask.createdOrder}
                )
              `
            }
          }),
        )
      }),
    )
  }

  async get(runId: string): Promise<OrchestrationRunRecord | null> {
    const safeRunId = normalizeRunId(runId)
    if (!safeRunId) {
      return null
    }

    const runRow = await getRunRow(safeRunId)
    if (!runRow) {
      return null
    }

    const taskRows = await listTaskRows(safeRunId)
    return buildSharedRunFromRows(runRow, taskRows)
  }

  async getCore(runId: string): Promise<CoreRunRecord | null> {
    const safeRunId = normalizeRunId(runId)
    if (!safeRunId) {
      return null
    }

    const runRow = await getRunRow(safeRunId)
    if (!runRow) {
      return null
    }

    const taskRows = await listTaskRows(safeRunId)
    return buildCoreRunFromRows(runRow, taskRows)
  }

  async list(conversationId?: ConversationId): Promise<OrchestrationRunRecord[]> {
    const runRows = await listRunRows(conversationId)
    const runs: OrchestrationRunRecord[] = []

    for (const row of runRows) {
      const taskRows = await listTaskRows(row.run_id)
      runs.push(buildSharedRunFromRows(row, taskRows))
    }

    return runs
  }

  async listCore(conversationId?: ConversationId): Promise<readonly CoreRunRecord[]> {
    const runRows = await listRunRows(conversationId)
    const runs: CoreRunRecord[] = []

    for (const row of runRows) {
      const taskRows = await listTaskRows(row.run_id)
      runs.push(buildCoreRunFromRows(row, taskRows))
    }

    return runs
  }

  async appendEvent(input: AppendEventInput): Promise<void> {
    const safeRunId = normalizeRunId(input.event.runId)
    if (!safeRunId) {
      throw new Error(`invalid run id: ${input.event.runId}`)
    }

    await runAppEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const versionRows = yield* sql<{ next_version: number }>`
              SELECT COALESCE(MAX(stream_version), 0) + 1 AS next_version
              FROM orchestration_events
              WHERE aggregate_kind = ${ORCHESTRATION_AGGREGATE_KIND}
                AND stream_id = ${safeRunId}
            `

            const nextVersion = versionRows[0]?.next_version ?? 1
            const payload = {
              conversationId: input.conversationId,
              ...input.event,
            }

            yield* sql`
              INSERT INTO orchestration_events (
                event_id,
                aggregate_kind,
                stream_id,
                stream_version,
                event_type,
                occurred_at,
                command_id,
                causation_event_id,
                correlation_id,
                actor_kind,
                payload_json,
                metadata_json
              )
              VALUES (
                ${randomUUID()},
                ${ORCHESTRATION_AGGREGATE_KIND},
                ${safeRunId},
                ${nextVersion},
                ${input.event.type},
                ${input.event.at},
                ${input.commandId ?? null},
                ${input.causationEventId ?? null},
                ${input.correlationId ?? null},
                ${input.actorKind ?? DEFAULT_ACTOR_KIND},
                ${JSON.stringify(payload)},
                ${JSON.stringify(input.metadata ?? {})}
              )
            `
          }),
        )
      }),
    )
  }

  async listEvents(runId: string): Promise<readonly PersistedOrchestrationEventRow[]> {
    const safeRunId = normalizeRunId(runId)
    if (!safeRunId) {
      return []
    }

    return runAppEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<PersistedOrchestrationEventRow>`
          SELECT sequence, event_type, occurred_at, payload_json, metadata_json
          FROM orchestration_events
          WHERE aggregate_kind = ${ORCHESTRATION_AGGREGATE_KIND}
            AND stream_id = ${safeRunId}
          ORDER BY stream_version ASC, sequence ASC
        `
      }),
    )
  }

  async markFallback(runId: string, reason?: string): Promise<void> {
    const current = await this.get(runId)
    if (!current) {
      return
    }

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
    if (!current) {
      return
    }

    const tasks: Record<string, OrchestrationTaskRecord> = {}
    for (const taskId of current.taskOrder) {
      const key = String(taskId)
      const task = current.tasks[key]
      if (!task) {
        continue
      }

      tasks[key] =
        task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'
          ? task
          : {
              ...task,
              status: 'cancelled',
              errorCode: CANCELLED_ERROR_CODE,
              error: reason ?? 'cancelled',
              finishedAt: new Date().toISOString(),
            }
    }

    const finishedAt = new Date().toISOString()
    const next: OrchestrationRunRecord = {
      ...current,
      status: 'cancelled',
      finishedAt,
      tasks,
      updatedAt: Date.now(),
    }

    await this.save(next)
    await this.appendEvent({
      conversationId: next.conversationId,
      actorKind: 'user',
      event: {
        type: 'run_cancelled',
        runId,
        at: finishedAt,
        reason,
      },
    })
  }

  private toCore(run: OrchestrationRunRecord): CoreRunRecord {
    const tasks: Record<string, CoreRunRecord['tasks'][string]> = {}

    for (let index = 0; index < run.taskOrder.length; index += 1) {
      const taskId = run.taskOrder[index]
      const key = String(taskId)
      const task = run.tasks[key]
      if (!task) {
        continue
      }

      tasks[key] = {
        id: key,
        kind: task.kind,
        dependsOn: task.dependsOn.map((dependencyId) => String(dependencyId)),
        status: task.status,
        retry: task.retry ?? { retries: 0, backoffMs: 0, jitterMs: 0 },
        attempts: task.attempts ? [...task.attempts] : [],
        createdOrder: task.createdOrder ?? index,
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
      maxParallelTasks: run.maxParallelTasks,
      tasks,
      taskOrder: run.taskOrder.map((taskId) => String(taskId)),
      outputs: run.outputs,
      summary: summarizeCoreRun(tasks),
    }
  }
}

export const orchestrationRunRepository = new OrchestrationRunRepository()
