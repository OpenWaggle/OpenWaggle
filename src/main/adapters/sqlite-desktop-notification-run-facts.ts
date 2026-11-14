import type * as SqlClient from '@effect/sql/SqlClient'
import { SCHEDULED_TASK_NOTIFICATION_POLICIES } from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import { durableSessionRunId } from '../domain/session-control/root-session-project-reach'

interface RunRow {
  readonly caller_id: string | null
  readonly author_caller_id: string | null
  readonly notification_policy: string | null
  readonly interrupted_by_caller_id: string | null
  readonly started_at: number | null
}

function decodePolicy(value: string | null) {
  return SCHEDULED_TASK_NOTIFICATION_POLICIES.find((policy) => policy === value) ?? null
}

/**
 * Who a Run acts for (ADR 0062, 0065): its caller and Scheduled task. A Hive wake acts for the
 * Session's latest Run before it, so it reads that Run's origin; who stopped it and when it was
 * created are the wake's own.
 */
export function selectRunFacts(sql: SqlClient.SqlClient, sessionId: string, runId: string) {
  return sql<RunRow>`
    WITH target AS (
      SELECT id, session_id, created_at, intent_json, interrupted_by_caller_id
      FROM session_runs
      WHERE id = ${durableSessionRunId(runId)} AND session_id = ${sessionId}
    ),
    origin AS (
      SELECT COALESCE(
        (
          SELECT prior.id FROM session_runs AS prior, target
          WHERE json_extract(target.intent_json, '$.hiveWake') = 1
            AND prior.session_id = target.session_id
            AND json_extract(prior.intent_json, '$.hiveWake') IS NULL
            AND (
              prior.created_at < target.created_at
              OR (prior.created_at = target.created_at AND prior.id < target.id)
            )
          ORDER BY prior.created_at DESC, prior.id DESC
          LIMIT 1
        ),
        (SELECT id FROM target)
      ) AS id
    )
    SELECT json_extract(session_runs.intent_json, '$.callerId') AS caller_id,
      json_extract(session_runs.intent_json, '$.authorCallerId') AS author_caller_id,
      scheduled_tasks.notification_policy,
      (SELECT interrupted_by_caller_id FROM target) AS interrupted_by_caller_id,
      (SELECT created_at FROM target) AS started_at
    FROM session_runs
    LEFT JOIN scheduled_task_runs
      ON scheduled_task_runs.run_id = session_runs.id
        OR scheduled_task_runs.idempotency_key =
          json_extract(session_runs.intent_json, '$.idempotencyKey')
    LEFT JOIN scheduled_tasks ON scheduled_tasks.id = scheduled_task_runs.task_id
    WHERE session_runs.id = (SELECT id FROM origin)
    LIMIT 1
  `.pipe(
    Effect.map((rows) => {
      const row = rows[0]
      if (!row) return null
      return {
        // A Run whose intent names no caller was started by the desktop app.
        originCallerId: row.author_caller_id ?? row.caller_id ?? 'gui:local-user',
        scheduledTaskPolicy: decodePolicy(row.notification_policy),
        interruptedByCallerId: row.interrupted_by_caller_id,
        startedAt: row.started_at,
      }
    }),
  )
}

/** The Session's latest Run by creation, or null when it has none. */
export function selectLatestRun(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<{ readonly id: string; readonly status: string; readonly hive_wake: number | null }>`
    SELECT id, status, json_extract(intent_json, '$.hiveWake') AS hive_wake
    FROM session_runs
    WHERE session_id = ${sessionId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `.pipe(
    Effect.map((rows) => {
      const row = rows[0]
      return row ? { runId: row.id, status: row.status, hiveWake: row.hive_wake === 1 } : null
    }),
  )
}
