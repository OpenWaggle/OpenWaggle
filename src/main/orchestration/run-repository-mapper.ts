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
import type { OrchestrationRunRecord as CoreRunRecord } from './engine'
import { summarizeCoreRun } from './run-record-transforms'

export interface OrchestrationRunRow {
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

export interface OrchestrationRunTaskRow {
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

export interface PersistedOrchestrationEventRow {
  readonly sequence: number
  readonly event_type: string
  readonly occurred_at: string
  readonly payload_json: string
  readonly metadata_json: string
}

const taskAttemptsSchema = Schema.mutable(Schema.Array(orchestrationTaskAttemptSchema))
const taskOrderSchema = Schema.mutable(Schema.Array(Schema.String))

export function parseJsonString(raw: string | null): unknown | null {
  if (raw === null) {
    return null
  }

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function parseTaskOrder(raw: string): readonly string[] {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(taskOrderSchema, parsed)
  return result.success ? result.data : []
}

export function parseOutputMap(raw: string): Readonly<Record<string, OrchestrationOutputValue>> {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(jsonObjectSchema, parsed)
  return result.success ? result.data : {}
}

export function parseJsonValue(raw: string | null): JsonValue | undefined {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(jsonValueSchema, parsed)
  return result.success ? result.data : undefined
}

export function parseJsonObject(raw: string | null): Readonly<JsonObject> | undefined {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(jsonObjectSchema, parsed)
  return result.success ? result.data : undefined
}

export function parseRetryPolicy(raw: string | null): CoreRunRecord['tasks'][string]['retry'] {
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

export function parseAttempts(
  raw: string | null,
): readonly CoreRunRecord['tasks'][string]['attempts'][number][] {
  const parsed = parseJsonString(raw)
  const result = safeDecodeUnknown(taskAttemptsSchema, parsed)
  return result.success ? result.data : []
}

export function buildCoreTaskFromRow(row: OrchestrationRunTaskRow): CoreRunRecord['tasks'][string] {
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

export function buildSharedRunFromRows(
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

export function buildCoreRunFromRows(
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
