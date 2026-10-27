import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  type NewScheduledTaskRecord,
  type ScheduledTaskRecord,
  ScheduledTaskRepository,
} from '../ports/scheduled-task-repository'
import {
  decodeScheduledTaskRow,
  repositoryError,
  SCHEDULED_TASK_COLUMNS,
  type ScheduledTaskRow,
} from './sqlite-scheduled-task-rows'
import { scheduledTaskRunMethods } from './sqlite-scheduled-task-run-store'
import { scheduledTaskSessionMethods } from './sqlite-scheduled-task-session-store'

function targetSessionId(record: ScheduledTaskRecord) {
  return record.target.kind === 'heartbeat' ? record.target.sessionId : null
}

function wakeCheckColumns(record: ScheduledTaskRecord) {
  const wakeCheck = record.wakeCheck
  return wakeCheck
    ? {
        command: wakeCheck.command,
        onFailure: wakeCheck.onFailure,
        approvedCommand: wakeCheck.approvedCommand,
        pendingSince: wakeCheck.pendingSince,
      }
    : { command: null, onFailure: 'wake', approvedCommand: null, pendingSince: null }
}

function autoPauseColumns(record: ScheduledTaskRecord) {
  const autoPause = record.autoPause
  return autoPause
    ? { reason: autoPause.reason, message: autoPause.message, since: autoPause.since }
    : { reason: null, message: null, since: null }
}

/** Writes the Heartbeat columns (#388) of a record. */
function writeHeartbeatColumns(sql: SqlClient.SqlClient, record: ScheduledTaskRecord) {
  const wakeCheck = wakeCheckColumns(record)
  const autoPause = autoPauseColumns(record)
  return sql`
    UPDATE scheduled_tasks SET
      stop_when = ${record.stopWhen}, indefinite = ${record.indefinite ? 1 : 0},
      idle_pause_after = ${record.idlePauseAfter},
      consecutive_idle_runs = ${record.consecutiveIdleRuns},
      wake_check_command = ${wakeCheck.command},
      wake_check_on_failure = ${wakeCheck.onFailure},
      wake_check_approved_command = ${wakeCheck.approvedCommand},
      wake_check_pending_since = ${wakeCheck.pendingSince},
      auto_pause_reason = ${autoPause.reason},
      auto_pause_message = ${autoPause.message},
      auto_paused_at = ${autoPause.since}
    WHERE id = ${record.id}
  `
}

function writeRecord(sql: SqlClient.SqlClient, record: NewScheduledTaskRecord) {
  return sql`
    INSERT INTO scheduled_tasks (
      id, owner_key, creator_caller_id, creator_kind, creator_label, creator_session_id,
      creator_working_directory, create_idempotency_key, kind, name, prompt, enabled,
      schedule_json, time_zone, anchor_at, ends_at, max_runs, target_session_id, target_json,
      project_path, notification_policy, attention_reason, attention_message, attention_since,
      next_run_at, next_nominal_at, waiting_since, run_count, created_at, updated_at
    ) VALUES (
      ${record.id}, ${record.ownerKey}, ${record.creatorCallerId}, ${record.creator.kind},
      ${record.creator.label}, ${record.creator.sessionId ?? null},
      ${record.creatorWorkingDirectory}, ${record.createIdempotencyKey}, ${record.kind},
      ${record.name}, ${record.prompt}, ${record.enabled ? 1 : 0},
      ${JSON.stringify(record.schedule)}, ${record.timeZone}, ${record.anchorAt},
      ${record.endsAt}, ${record.maxRuns}, ${targetSessionId(record)},
      ${JSON.stringify(record.target)}, ${record.projectPath}, ${record.notificationPolicy},
      ${record.attention?.reason ?? null}, ${record.attention?.message ?? null},
      ${record.attention?.since ?? null}, ${record.nextRunAt}, ${record.nextNominalAt},
      ${record.waitingSince}, ${record.runCount}, ${record.createdAt}, ${record.updatedAt}
    )
  `
}

function selectTask(sql: SqlClient.SqlClient, taskId: string) {
  return sql<ScheduledTaskRow>`
    SELECT ${sql.unsafe(SCHEDULED_TASK_COLUMNS)} FROM scheduled_tasks WHERE id = ${taskId} LIMIT 1
  `.pipe(Effect.map((rows) => (rows[0] ? decodeScheduledTaskRow(rows[0]) : null)))
}

function rewriteRecord(
  sql: SqlClient.SqlClient,
  expectedUpdatedAt: number,
  record: ScheduledTaskRecord,
) {
  return sql<{ readonly id: string }>`
    UPDATE scheduled_tasks SET
      name = ${record.name}, prompt = ${record.prompt}, enabled = ${record.enabled ? 1 : 0},
      schedule_json = ${JSON.stringify(record.schedule)}, time_zone = ${record.timeZone},
      anchor_at = ${record.anchorAt}, ends_at = ${record.endsAt}, max_runs = ${record.maxRuns},
      target_json = ${JSON.stringify(record.target)}, project_path = ${record.projectPath},
      notification_policy = ${record.notificationPolicy},
      attention_reason = ${record.attention?.reason ?? null},
      attention_message = ${record.attention?.message ?? null},
      attention_since = ${record.attention?.since ?? null},
      next_run_at = ${record.nextRunAt}, next_nominal_at = ${record.nextNominalAt},
      waiting_since = ${record.waitingSince}, run_count = ${record.runCount},
      updated_at = ${record.updatedAt}
    WHERE id = ${record.id} AND updated_at = ${expectedUpdatedAt}
    RETURNING id
  `.pipe(Effect.tap((rows) => (rows.length > 0 ? writeHeartbeatColumns(sql, record) : Effect.void)))
}

function makeRepository(sql: SqlClient.SqlClient) {
  return ScheduledTaskRepository.of({
    insert: (record) =>
      writeRecord(sql, record).pipe(
        Effect.zipRight(writeHeartbeatColumns(sql, record)),
        sql.withTransaction,
        Effect.zipRight(selectTask(sql, record.id)),
        Effect.flatMap((stored) =>
          stored ? Effect.succeed(stored) : Effect.fail(new Error('Inserted task vanished.')),
        ),
        Effect.mapError(repositoryError('insert-scheduled-task')),
      ),
    findByCreateKey: (ownerKey, key) =>
      sql<ScheduledTaskRow>`
        SELECT ${sql.unsafe(SCHEDULED_TASK_COLUMNS)} FROM scheduled_tasks
        WHERE owner_key = ${ownerKey} AND create_idempotency_key = ${key} LIMIT 1
      `.pipe(
        Effect.map((rows) => (rows[0] ? decodeScheduledTaskRow(rows[0]) : null)),
        Effect.mapError(repositoryError('find-scheduled-task-by-key')),
      ),
    get: (taskId) =>
      selectTask(sql, taskId).pipe(Effect.mapError(repositoryError('get-scheduled-task'))),
    update: (taskId, expectedUpdatedAt, changes) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const current = yield* selectTask(sql, taskId)
            if (!current || current.updatedAt !== expectedUpdatedAt) return null
            const next: ScheduledTaskRecord = { ...current, ...changes }
            const updated = yield* rewriteRecord(sql, expectedUpdatedAt, next)
            return updated.length > 0 ? next : null
          }),
        )
        .pipe(Effect.mapError(repositoryError('update-scheduled-task'))),
    delete: (taskId) =>
      sql<{
        readonly id: string
      }>`DELETE FROM scheduled_tasks WHERE id = ${taskId} RETURNING id`.pipe(
        Effect.map((rows) => rows.length > 0),
        Effect.mapError(repositoryError('delete-scheduled-task')),
      ),
    list: (filter) =>
      sql<ScheduledTaskRow>`
        SELECT ${sql.unsafe(SCHEDULED_TASK_COLUMNS)} FROM scheduled_tasks
        WHERE (${filter.ownerKey ?? null} IS NULL OR owner_key = ${filter.ownerKey ?? null})
          AND (${filter.projectPath ?? null} IS NULL OR project_path = ${filter.projectPath ?? null})
          AND (${filter.targetSessionId ?? null} IS NULL
            OR target_session_id = ${filter.targetSessionId ?? null})
        ORDER BY project_path, name COLLATE NOCASE, id
        LIMIT ${filter.limit}
      `.pipe(
        Effect.map((rows) => rows.map(decodeScheduledTaskRow)),
        Effect.mapError(repositoryError('list-scheduled-tasks')),
      ),
    countForOwner: (ownerKey) =>
      sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM scheduled_tasks WHERE owner_key = ${ownerKey}
      `.pipe(
        Effect.map((rows) => rows[0]?.count ?? 0),
        Effect.mapError(repositoryError('count-scheduled-tasks')),
      ),
    listDue: (now, limit) =>
      sql<ScheduledTaskRow>`
        SELECT ${sql.unsafe(SCHEDULED_TASK_COLUMNS)} FROM scheduled_tasks
        WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ${now}
        ORDER BY next_run_at, id LIMIT ${limit}
      `.pipe(
        Effect.map((rows) => rows.map(decodeScheduledTaskRow)),
        Effect.mapError(repositoryError('list-due-scheduled-tasks')),
      ),
    listEnabled: () =>
      sql<ScheduledTaskRow>`
        SELECT ${sql.unsafe(SCHEDULED_TASK_COLUMNS)} FROM scheduled_tasks
        WHERE enabled = 1 ORDER BY next_run_at, id
      `.pipe(
        Effect.map((rows) => rows.map(decodeScheduledTaskRow)),
        Effect.mapError(repositoryError('list-enabled-scheduled-tasks')),
      ),
    ...scheduledTaskRunMethods(sql),
    ...scheduledTaskSessionMethods(sql),
  })
}

export const SqliteScheduledTaskRepositoryLive = Layer.effect(
  ScheduledTaskRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return makeRepository(sql)
  }),
)
