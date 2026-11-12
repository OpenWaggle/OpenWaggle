import * as SqlClient from '@effect/sql/SqlClient'
import { LIVE_RUN_STATUSES } from '@shared/domain/running-workers'
import { parseJsonUnknown } from '@shared/schema'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { durableSessionRunId } from '../domain/session-control/root-session-project-reach'
import {
  DesktopNotificationFacts,
  type DesktopNotificationFactsShape,
} from '../ports/desktop-notification-facts'
import { messageCallerBlockReason } from './session-follow-up-authorization'
import { selectLatestRun, selectRunFacts } from './sqlite-desktop-notification-run-facts'
import { parentWillActSql } from './sqlite-hive-next-actor-facts'
import { selectHiveParentWakeCandidate } from './sqlite-hive-parent-wake-candidate'
import { wakeCandidateMayWake } from './sqlite-hive-wake-trigger-authority'
import { countActiveWorkerRuns, isAgentMadeSession } from './sqlite-worker-run-admission'

interface SessionRow {
  readonly id: string
  readonly title: string
  readonly project_path: string | null
  readonly archived: number
  readonly parent_session_id: string | null
  readonly parent_title: string | null
}

interface HiveActivityRow {
  readonly root_running: number
  readonly workers_running: number
  readonly run_started_while_workers_ran: number
  readonly waking_parent_ids: string
}

function decodeSessionIds(value: string) {
  const decoded: unknown = parseJsonUnknown(value)
  if (!Array.isArray(decoded)) return []
  const entries: readonly unknown[] = decoded
  return entries.filter((entry): entry is string => typeof entry === 'string')
}

/**
 * Whether the Host would still wake `parentSessionId` (`hive-parent-wake.ts`): the wake candidate
 * SQL finds an unread update a wake acts on, the latest Run's caller may still message the
 * parent, and a cause of that update may wake it. A full Active Workers limit only defers an
 * agent-made parent's wake, so it still counts as coming; the pi CLI check is not repeated here.
 */
function wakeComingFor(sql: SqlClient.SqlClient, parentSessionId: string) {
  return Effect.gen(function* () {
    const candidate = yield* selectHiveParentWakeCandidate(sql, { parentSessionId })
    if (!candidate) return false
    const blocked = yield* messageCallerBlockReason(sql, parentSessionId, candidate.callerId)
    if (blocked) return false
    return yield* wakeCandidateMayWake(sql, candidate)
  })
}

/** The topmost Session above `sessionId` by spawn lineage; a Session with no parent is its own. */
function selectHiveRootSessionId(sql: SqlClient.SqlClient, sessionId: string) {
  return sql<{ readonly session_id: string }>`
    WITH RECURSIVE ancestors(session_id) AS (
      SELECT ${sessionId}
      UNION
      SELECT lineage.parent_session_id
      FROM session_spawn_lineage AS lineage
      JOIN ancestors ON lineage.child_session_id = ancestors.session_id
    )
    SELECT ancestors.session_id FROM ancestors
    WHERE NOT EXISTS (
      SELECT 1 FROM session_spawn_lineage
      WHERE session_spawn_lineage.child_session_id = ancestors.session_id
    )
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]?.session_id ?? sessionId))
}

/**
 * What still runs in the spawn subtree of `rootSessionId` (ADR 0065), every depth and archived
 * Workers included; historical `session_lineage` is not a Hive. `runId`, a Run of the root, started
 * mid-work when a Worker Run below began at or before it and was still running when it began.
 */
function selectHiveActivity(sql: SqlClient.SqlClient, rootSessionId: string, runId: string | null) {
  return Effect.gen(function* () {
    const askedRunId = runId === null ? null : durableSessionRunId(runId)
    const running = sql.in([...LIVE_RUN_STATUSES])
    const [row] = yield* sql<HiveActivityRow>`
      WITH RECURSIVE subtree(session_id) AS (
        SELECT ${rootSessionId}
        UNION
        SELECT lineage.child_session_id
        FROM session_spawn_lineage AS lineage
        JOIN subtree ON lineage.parent_session_id = subtree.session_id
      ),
      workers(session_id) AS (
        SELECT session_id FROM subtree WHERE session_id <> ${rootSessionId}
      ),
      asked(asked_at) AS (
        SELECT COALESCE(json_extract(intent_json, '$.acceptedAt'), created_at) FROM session_runs
        WHERE id = ${askedRunId} AND session_id = ${rootSessionId}
      )
      SELECT
        EXISTS (
          SELECT 1 FROM session_runs
          WHERE session_runs.session_id = ${rootSessionId} AND session_runs.status IN ${running}
        ) AS root_running,
        EXISTS (
          SELECT 1 FROM session_runs JOIN workers USING (session_id)
          WHERE session_runs.status IN ${running}
        ) AS workers_running,
        EXISTS (
          SELECT 1 FROM session_runs JOIN workers USING (session_id) JOIN asked
          WHERE session_runs.created_at <= asked.asked_at
            AND (
              session_runs.status IN ${running}
              OR session_runs.updated_at > asked.asked_at
            )
        ) AS run_started_while_workers_ran,
        (
          SELECT json_group_array(DISTINCT updates.parent_session_id)
          FROM session_orchestration_updates AS updates
          JOIN subtree ON subtree.session_id = updates.parent_session_id
          WHERE updates.status = ${'pending'}
        ) AS waking_parent_ids
    `
    let wakeComing = false
    let limitedWakeComing = false
    for (const parentSessionId of decodeSessionIds(row?.waking_parent_ids ?? '[]')) {
      if (!(yield* wakeComingFor(sql, parentSessionId))) continue
      wakeComing = true
      limitedWakeComing = yield* isAgentMadeSession(sql, parentSessionId)
      if (limitedWakeComing) break
    }
    return {
      rootRunning: row?.root_running === 1,
      workersRunning: row?.workers_running === 1,
      wakeComing,
      limitedWakeComing,
      runStartedWhileWorkersRan: row?.run_started_while_workers_ran === 1,
    }
  })
}

function factsError(operation: string) {
  return (cause: unknown) =>
    new Error(`Desktop notification facts could not be read (${operation}).`, { cause })
}

function makeFacts(sql: SqlClient.SqlClient) {
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
      selectRunFacts(sql, sessionId, runId).pipe(Effect.mapError(factsError('run'))),
    hiveRootSessionId: (sessionId) =>
      selectHiveRootSessionId(sql, sessionId).pipe(Effect.mapError(factsError('hive-root'))),
    hiveActivity: (rootSessionId, runId) =>
      selectHiveActivity(sql, rootSessionId, runId).pipe(
        Effect.mapError(factsError('hive-activity')),
      ),
    latestRun: (sessionId) =>
      selectLatestRun(sql, sessionId).pipe(Effect.mapError(factsError('latest-run'))),
    activeWorkerRunCount: () =>
      countActiveWorkerRuns(sql).pipe(Effect.mapError(factsError('active-worker-runs'))),
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
  } satisfies DesktopNotificationFactsShape
}

export const SqliteDesktopNotificationFactsLive = Layer.effect(
  DesktopNotificationFacts,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return makeFacts(sql)
  }),
)
