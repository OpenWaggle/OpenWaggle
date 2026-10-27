import type * as SqlClient from '@effect/sql/SqlClient'
import type { ScheduledTaskRunTrigger } from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import { encodeHeartbeatRunContext } from '../domain/scheduled-tasks/heartbeat-run-context'
import type {
  InterruptedRunMessages,
  InterruptedScheduledTaskRun,
  ScheduledTaskRepositoryShape,
  ScheduledTaskRunSettlement,
  ScheduledTaskRunStart,
} from '../ports/scheduled-task-repository'
import {
  decodeScheduledTaskRunRow,
  repositoryError,
  SCHEDULED_TASK_RUN_COLUMNS,
  type ScheduledTaskRunRow,
} from './sqlite-scheduled-task-rows'

function runStartValues(run: ScheduledTaskRunStart) {
  return {
    id: run.id,
    task_id: run.taskId,
    task_name: run.taskName,
    trigger: run.trigger,
    nominal_at: run.nominalAt,
    fired_at: run.firedAt,
    missed_count: run.missedCount,
    idempotency_key: run.idempotencyKey,
    caller_id: run.callerId,
    previous_session_id: run.previousSessionId,
    previous_fired_at: run.previousFiredAt,
    context_json: run.context ? encodeHeartbeatRunContext(run.context) : null,
  }
}

function insertRun(
  sql: SqlClient.SqlClient,
  run: ScheduledTaskRunStart,
  settlement: ScheduledTaskRunSettlement | null,
) {
  const values = runStartValues(run)
  return sql`
    INSERT INTO scheduled_task_runs (
      id, task_id, task_name, trigger, nominal_at, fired_at, missed_count, status, reason,
      message, idempotency_key, caller_id, session_id, run_id, previous_session_id,
      previous_fired_at, wake_check, context_json
    ) VALUES (
      ${values.id}, ${values.task_id}, ${values.task_name}, ${values.trigger}, ${values.nominal_at},
      ${values.fired_at}, ${values.missed_count}, ${settlement?.status ?? 'dispatching'},
      ${settlement?.reason ?? null}, ${settlement?.message ?? null}, ${values.idempotency_key},
      ${values.caller_id}, ${settlement?.sessionId ?? null}, ${settlement?.runId ?? null},
      ${values.previous_session_id}, ${values.previous_fired_at},
      ${settlement?.wakeCheck ?? null}, ${values.context_json}
    )
  `
}

interface InterruptedRunRow {
  readonly id: string
  readonly task_id: string
  readonly trigger: string
  readonly nominal_at: number
  readonly operation_recorded: number
  readonly session_id: string | null
  readonly run_id: string | null
}

function isRunTrigger(value: string): value is ScheduledTaskRunTrigger {
  return value === 'schedule' || value === 'catch-up' || value === 'run-now'
}

/**
 * Session Control records each accepted or refused request under its caller and idempotency key
 * in the same transaction as its effect, so that record says whether an interrupted run was sent.
 */
function settleInterruptedRuns(sql: SqlClient.SqlClient, messages: InterruptedRunMessages) {
  return Effect.gen(function* () {
    const rows = yield* sql<InterruptedRunRow>`
      SELECT runs.id, runs.task_id, runs.trigger, runs.nominal_at,
        operations.id IS NOT NULL AS operation_recorded,
        json_extract(operations.outcome_json, '$.sessionId') AS session_id,
        json_extract(operations.outcome_json, '$.runId') AS run_id
      FROM scheduled_task_runs AS runs
      LEFT JOIN session_operations AS operations
        ON operations.caller_id = runs.caller_id
        AND operations.idempotency_key = runs.idempotency_key
        AND operations.status = 'completed'
      WHERE runs.status = 'dispatching'
    `
    const settled: InterruptedScheduledTaskRun[] = []
    for (const row of rows) {
      const started = row.run_id !== null && row.session_id !== null
      const delivered = row.operation_recorded !== 0
      if (started) {
        yield* sql`
          UPDATE scheduled_task_runs SET status = 'started', session_id = ${row.session_id},
            run_id = ${row.run_id}
          WHERE id = ${row.id}
        `
      } else {
        yield* sql`
          UPDATE scheduled_task_runs SET status = 'failed', reason = 'interrupted-by-host-stop',
            message = ${delivered ? messages.refused : messages.notSent}
          WHERE id = ${row.id}
        `
      }
      settled.push({
        taskId: row.task_id,
        trigger: isRunTrigger(row.trigger) ? row.trigger : 'schedule',
        nominalAt: row.nominal_at,
        delivered,
        started,
      })
    }
    return settled
  }).pipe(sql.withTransaction)
}

type RunMethods = Pick<
  ScheduledTaskRepositoryShape,
  | 'startRun'
  | 'settleRun'
  | 'recordRun'
  | 'runOfSessionRun'
  | 'recordRunOutcome'
  | 'getRun'
  | 'listRuns'
  | 'lastRuns'
  | 'recentSessionIds'
  | 'lastStartedRun'
  | 'settleInterruptedRuns'
>

export function scheduledTaskRunMethods(sql: SqlClient.SqlClient): RunMethods {
  return {
    startRun: (run) =>
      insertRun(sql, run, null).pipe(Effect.asVoid, Effect.mapError(repositoryError('start-run'))),
    settleRun: (runId, settlement) =>
      sql`
        UPDATE scheduled_task_runs SET status = ${settlement.status},
          reason = ${settlement.reason ?? null}, message = ${settlement.message ?? null},
          session_id = COALESCE(${settlement.sessionId ?? null}, session_id),
          run_id = COALESCE(${settlement.runId ?? null}, run_id),
          wake_check = COALESCE(${settlement.wakeCheck ?? null}, wake_check)
        WHERE id = ${runId}
      `.pipe(Effect.asVoid, Effect.mapError(repositoryError('settle-run'))),
    recordRun: (run) =>
      insertRun(sql, run, run).pipe(Effect.asVoid, Effect.mapError(repositoryError('record-run'))),
    ...scheduledTaskRunOutcomeMethods(sql),
    listRuns: (input) =>
      sql<ScheduledTaskRunRow>`
        SELECT ${sql.unsafe(SCHEDULED_TASK_RUN_COLUMNS)} FROM scheduled_task_runs
        WHERE task_id = ${input.taskId}
          AND (${input.before ?? null} IS NULL OR fired_at < ${input.before ?? null})
        ORDER BY fired_at DESC, id DESC LIMIT ${input.limit}
      `.pipe(
        Effect.map((rows) => rows.map(decodeScheduledTaskRunRow)),
        Effect.mapError(repositoryError('list-runs')),
      ),
    lastRuns: (taskIds) =>
      taskIds.length === 0
        ? Effect.succeed(new Map())
        : sql<ScheduledTaskRunRow>`
            SELECT ${sql.unsafe(SCHEDULED_TASK_RUN_COLUMNS)} FROM scheduled_task_runs AS runs
            WHERE runs.task_id IN ${sql.in(taskIds)}
              AND runs.id = (
                SELECT latest.id FROM scheduled_task_runs AS latest
                WHERE latest.task_id = runs.task_id
                ORDER BY latest.fired_at DESC, latest.id DESC LIMIT 1
              )
          `.pipe(
            Effect.map(
              (rows) => new Map(rows.map((row) => [row.task_id, decodeScheduledTaskRunRow(row)])),
            ),
            Effect.mapError(repositoryError('last-runs')),
          ),
    recentSessionIds: (taskIds, perTask) =>
      taskIds.length === 0
        ? Effect.succeed(new Map())
        : sql<{ readonly task_id: string; readonly session_id: string }>`
            SELECT task_id, session_id FROM (
              SELECT task_id, session_id, MAX(fired_at) AS fired_at,
                ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY MAX(fired_at) DESC) AS position
              FROM scheduled_task_runs
              WHERE task_id IN ${sql.in(taskIds)} AND session_id IS NOT NULL
                AND status IN ('started', 'dispatching')
              GROUP BY task_id, session_id
            ) WHERE position <= ${perTask}
            ORDER BY task_id, fired_at DESC
          `.pipe(
            Effect.map((rows) => {
              const byTask = new Map<string, string[]>()
              for (const row of rows) {
                const list = byTask.get(row.task_id) ?? []
                list.push(row.session_id)
                byTask.set(row.task_id, list)
              }
              return byTask
            }),
            Effect.mapError(repositoryError('recent-session-ids')),
          ),
    lastStartedRun: (taskId) =>
      sql<ScheduledTaskRunRow>`
        SELECT ${sql.unsafe(SCHEDULED_TASK_RUN_COLUMNS)} FROM scheduled_task_runs
        WHERE task_id = ${taskId} AND status IN ('started', 'dispatching')
        ORDER BY fired_at DESC, id DESC LIMIT 1
      `.pipe(
        Effect.map((rows) => (rows[0] ? decodeScheduledTaskRunRow(rows[0]) : null)),
        Effect.mapError(repositoryError('last-started-run')),
      ),
    settleInterruptedRuns: (messages) =>
      settleInterruptedRuns(sql, messages).pipe(
        Effect.mapError(repositoryError('settle-interrupted-runs')),
      ),
  }
}

type RunOutcomeMethods = Pick<
  ScheduledTaskRepositoryShape,
  'runOfSessionRun' | 'recordRunOutcome' | 'getRun'
>

function scheduledTaskRunOutcomeMethods(sql: SqlClient.SqlClient): RunOutcomeMethods {
  return {
    runOfSessionRun: (sessionRunId) =>
      sql<ScheduledTaskRunRow & { readonly session_id: string }>`
        SELECT ${sql.unsafe(SCHEDULED_TASK_RUN_COLUMNS)} FROM scheduled_task_runs
        WHERE run_id = ${sessionRunId} AND session_id IS NOT NULL
          AND status IN ('started', 'dispatching')
        ORDER BY fired_at DESC LIMIT 1
      `.pipe(
        Effect.map((rows) => {
          const row = rows[0]
          if (!row) return null
          const run = decodeScheduledTaskRunRow(row)
          return {
            id: row.id,
            taskId: row.task_id,
            sessionId: row.session_id,
            outcome: run.outcome ?? null,
          }
        }),
        Effect.mapError(repositoryError('run-of-session-run')),
      ),
    recordRunOutcome: (runId, outcome) =>
      sql<{ readonly id: string }>`
        UPDATE scheduled_task_runs SET outcome = ${outcome.value},
          outcome_source = ${outcome.source}, outcome_note = ${outcome.note ?? null}
        WHERE id = ${runId} AND (outcome IS NULL OR ${outcome.source} = 'reported')
        RETURNING id
      `.pipe(
        Effect.map((rows) => rows.length > 0),
        Effect.mapError(repositoryError('record-run-outcome')),
      ),
    getRun: (runId) =>
      sql<ScheduledTaskRunRow>`
        SELECT ${sql.unsafe(SCHEDULED_TASK_RUN_COLUMNS)} FROM scheduled_task_runs
        WHERE id = ${runId} LIMIT 1
      `.pipe(
        Effect.map((rows) => (rows[0] ? decodeScheduledTaskRunRow(rows[0]) : null)),
        Effect.mapError(repositoryError('get-run')),
      ),
  }
}
