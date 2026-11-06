import * as SqlClient from '@effect/sql/SqlClient'
import { SCHEDULED_TASK_NOTIFICATION_POLICIES } from '@shared/types/scheduled-task'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { durableSessionRunId } from '../domain/session-control/root-session-project-reach'
import {
  DesktopNotificationFacts,
  type DesktopNotificationFactsShape,
} from '../ports/desktop-notification-facts'
import { parentWillActSql } from './sqlite-hive-next-actor-facts'

interface SessionRow {
  readonly id: string
  readonly title: string
  readonly project_path: string | null
  readonly archived: number
  readonly parent_session_id: string | null
  readonly parent_title: string | null
}

interface RunRow {
  readonly caller_id: string | null
  readonly author_caller_id: string | null
  readonly notification_policy: string | null
}

function factsError(operation: string) {
  return (cause: unknown) =>
    new Error(`Desktop notification facts could not be read (${operation}).`, { cause })
}

function decodePolicy(value: string | null) {
  return SCHEDULED_TASK_NOTIFICATION_POLICIES.find((policy) => policy === value) ?? null
}

function makeFacts(sql: SqlClient.SqlClient): DesktopNotificationFactsShape {
  return {
    session: (sessionId) =>
      sql<SessionRow>`
        SELECT sessions.id, sessions.title, sessions.project_path, sessions.archived,
          session_spawn_lineage.parent_session_id, parent_sessions.title AS parent_title
        FROM sessions
        LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
        LEFT JOIN sessions AS parent_sessions
          ON parent_sessions.id = session_spawn_lineage.parent_session_id
        WHERE sessions.id = ${sessionId}
        LIMIT 1
      `.pipe(
        Effect.map((rows) => {
          const row = rows[0]
          if (!row) return null
          return {
            sessionId: row.id,
            title: row.title,
            projectPath: row.project_path,
            archived: row.archived !== 0,
            parentSessionId: row.parent_session_id,
            parentTitle: row.parent_title,
          }
        }),
        Effect.mapError(factsError('session')),
      ),
    run: (sessionId, runId) =>
      sql<RunRow>`
        SELECT json_extract(session_runs.intent_json, '$.callerId') AS caller_id,
          json_extract(session_runs.intent_json, '$.authorCallerId') AS author_caller_id,
          scheduled_tasks.notification_policy
        FROM session_runs
        LEFT JOIN scheduled_task_runs
          ON scheduled_task_runs.run_id = session_runs.id
            OR scheduled_task_runs.idempotency_key =
              json_extract(session_runs.intent_json, '$.idempotencyKey')
        LEFT JOIN scheduled_tasks ON scheduled_tasks.id = scheduled_task_runs.task_id
        WHERE session_runs.id = ${durableSessionRunId(runId)}
          AND session_runs.session_id = ${sessionId}
        LIMIT 1
      `.pipe(
        Effect.map((rows) => {
          const row = rows[0]
          if (!row) return null
          return {
            // A Run whose intent names no caller was started by the desktop app.
            originCallerId: row.author_caller_id ?? row.caller_id ?? 'gui:local-user',
            scheduledTaskPolicy: decodePolicy(row.notification_policy),
          }
        }),
        Effect.mapError(factsError('run')),
      ),
    lastVisitedAt: (sessionId) =>
      sql<{ readonly last_visited_at: number | null }>`
        SELECT last_visited_at FROM session_visit_receipts WHERE session_id = ${sessionId} LIMIT 1
      `.pipe(
        Effect.map((rows) => rows[0]?.last_visited_at ?? null),
        Effect.mapError(factsError('visit')),
      ),
    stuckWorkerIds: () =>
      sql<{ readonly session_id: string }>`
        SELECT contracts.child_session_id AS session_id
        FROM delegation_contracts AS contracts
        JOIN sessions ON sessions.id = contracts.child_session_id
        WHERE contracts.state = ${'needs_attention'}
          AND sessions.archived = 0
          AND NOT ${sql.literal(parentWillActSql('contracts'))}
      `.pipe(
        Effect.map((rows) => rows.map((row) => row.session_id)),
        Effect.mapError(factsError('stuck-workers')),
      ),
    runsInterruptedByHostLossSince: (since) =>
      sql<{ readonly session_id: string; readonly id: string }>`
        SELECT session_id, id FROM session_runs
        WHERE status = ${'interrupted-by-host-loss'} AND updated_at >= ${since}
        ORDER BY updated_at ASC
      `.pipe(
        Effect.map((rows) => rows.map((row) => ({ sessionId: row.session_id, runId: row.id }))),
        Effect.mapError(factsError('host-loss-runs')),
      ),
  }
}

export const SqliteDesktopNotificationFactsLive = Layer.effect(
  DesktopNotificationFacts,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return makeFacts(sql)
  }),
)
