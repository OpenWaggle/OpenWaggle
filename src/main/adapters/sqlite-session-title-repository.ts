import * as SqlClient from '@effect/sql/SqlClient'
import { assertSessionTitle } from '@shared/session-title'
import { isSessionTitleSource, type SessionTitleSource } from '@shared/session-title-source'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionTitleRepositoryError } from '../errors'
import {
  SessionTitleRepository,
  type SessionTitleRepositoryShape,
  type SessionTitleState,
} from '../ports/session-title-repository'
import { persistSessionReportTitleReference } from './sqlite-session-report-reference-catalog'

interface SessionTitleRow {
  readonly id: string
  readonly title: string
  readonly title_source: string
  readonly title_needs_refinement: number
  readonly project_path: string | null
  readonly archived: number
  readonly execution_model_id: string | null
  readonly is_worker: number
  readonly updated_at: number
}

function repositoryError(operation: string, cause: unknown) {
  return new SessionTitleRepositoryError({ operation, cause })
}

function toState(row: SessionTitleRow): SessionTitleState {
  if (!isSessionTitleSource(row.title_source)) {
    throw new Error(`Session ${row.id} has an unknown title source: ${row.title_source}`)
  }
  return {
    sessionId: SessionId(row.id),
    title: row.title,
    source: row.title_source,
    needsRefinement: row.title_needs_refinement === 1,
    projectPath: row.project_path,
    executionModel: row.execution_model_id ? SupportedModelId(row.execution_model_id) : null,
    archived: row.archived === 1,
    isWorker: row.is_worker === 1,
    updatedAt: row.updated_at,
  }
}

function getState(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return Effect.gen(function* () {
    const rows = yield* sql<SessionTitleRow>`
      SELECT
        sessions.id,
        sessions.title,
        sessions.title_source,
        sessions.title_needs_refinement,
        sessions.project_path,
        sessions.archived,
        sessions.updated_at,
        json_extract(session_execution_profiles.profile_json, '$.modelId') AS execution_model_id,
        EXISTS (
          SELECT 1 FROM session_spawn_lineage
          WHERE session_spawn_lineage.child_session_id = sessions.id
        ) AS is_worker
      FROM sessions
      LEFT JOIN session_execution_profiles
        ON session_execution_profiles.session_id = sessions.id
      WHERE sessions.id = ${sessionId}
      LIMIT 1
    `
    const row = rows[0]
    return row ? yield* Effect.try(() => toState(row)) : null
  })
}

function sourcesList(sql: SqlClient.SqlClient, sources: readonly SessionTitleSource[]) {
  return sql.in(sources)
}

/**
 * Title writes never touch `updated_at`: a title is metadata, and recency means recent work, so
 * neither generation nor refinement may move a Session in the sidebar (ADR 0043).
 */
function applyGenerated(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionTitleRepositoryShape['applyGenerated']>[0],
) {
  const title = assertSessionTitle(input.title)
  return sql.withTransaction(
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly id: string }>`
        UPDATE sessions
        SET title = ${title},
          title_source = ${'generated'},
          title_needs_refinement = ${input.needsRefinement ? 1 : 0}
        WHERE id = ${input.sessionId}
          AND title = ${input.expected.title}
          AND title_source IN ${sourcesList(sql, input.expected.sources)}
        RETURNING id
      `
      if (rows.length === 0) return false
      yield* persistSessionReportTitleReference(sql, input.sessionId, title)
      return true
    }),
  )
}

export const SqliteSessionTitleRepositoryLive = Layer.effect(
  SessionTitleRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionTitleRepository.of({
      getState: (sessionId) =>
        getState(sql, sessionId).pipe(Effect.mapError((cause) => repositoryError('get', cause))),
      applyGenerated: (input) =>
        applyGenerated(sql, input).pipe(
          Effect.mapError((cause) => repositoryError('apply-generated', cause)),
        ),
      clearRefinement: (sessionId) =>
        sql`UPDATE sessions SET title_needs_refinement = ${0} WHERE id = ${sessionId}`.pipe(
          Effect.asVoid,
          Effect.mapError((cause) => repositoryError('clear-refinement', cause)),
        ),
      listPendingRefinements: ({ activeAfter, limit }) =>
        sql<{ readonly id: string }>`
          SELECT id FROM sessions
          WHERE title_needs_refinement = ${1} AND title_source = ${'generated'} AND archived = ${0}
            AND updated_at >= ${activeAfter}
          ORDER BY updated_at DESC
          LIMIT ${limit}
        `.pipe(
          Effect.map((rows) => rows.map((row) => SessionId(row.id))),
          Effect.mapError((cause) => repositoryError('list-pending-refinements', cause)),
        ),
      settleRefinementsIdleSince: (activeBefore) =>
        sql`UPDATE sessions SET title_needs_refinement = ${0}
          WHERE title_needs_refinement = ${1} AND updated_at < ${activeBefore}`.pipe(
          Effect.asVoid,
          Effect.mapError((cause) => repositoryError('settle-stale-refinements', cause)),
        ),
      listRecentProvisional: ({ activeAfter, limit }) =>
        sql<{ readonly id: string }>`
          SELECT id FROM sessions
          WHERE title_source = ${'provisional'} AND archived = ${0} AND updated_at >= ${activeAfter}
          ORDER BY updated_at DESC
          LIMIT ${limit}
        `.pipe(
          Effect.map((rows) => rows.map((row) => SessionId(row.id))),
          Effect.mapError((cause) => repositoryError('list-recent-provisional', cause)),
        ),
    })
  }),
)
