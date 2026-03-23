import { randomUUID } from 'node:crypto'
import * as SqlClient from '@effect/sql/SqlClient'
import type { ConversationId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import type { OrchestrationRunRecord, OrchestrationTaskRecord } from '@shared/types/orchestration'
import * as Effect from 'effect/Effect'
import { runAppEffect } from '../runtime'
import type {
  OrchestrationRunRecord as CoreRunRecord,
  OrchestrationEvent,
  RunStore,
} from './engine'
import {
  CANCELLED_ERROR_CODE,
  extractTaskTitle,
  normalizeRunId,
  summarizeCoreRun,
  toSharedRunRecord,
} from './run-record-transforms'
import {
  buildCoreRunFromRows,
  buildSharedRunFromRows,
  type OrchestrationRunRow,
  type OrchestrationRunTaskRow,
  type PersistedOrchestrationEventRow,
} from './run-repository-mapper'

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
