import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  authorizedSessionScope,
  decodeSessionQueryCursor,
  encodeSessionQueryCursor,
  invalidSessionQueryCursor,
  type SessionQuerySummaryRow,
  sessionQueryResponse,
  sessionQuerySummary,
} from './sqlite-session-query-support'

type ListRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { operation: 'list' }>
}

interface ListResultRow extends SessionQuerySummaryRow {
  readonly total_count: number | null
}

const MINIMUM_TRIGRAM_SEARCH_LENGTH = 3

function listCursor(request: ListRequest) {
  const cursor = decodeSessionQueryCursor(request.query.cursor)
  if (cursor === 'invalid') return 'invalid' as const
  if (!cursor) return null
  return typeof cursor.updatedAt === 'number' && typeof cursor.sessionId === 'string'
    ? { updatedAt: cursor.updatedAt, sessionId: cursor.sessionId }
    : ('invalid' as const)
}

function archivedFilter(value: boolean | undefined) {
  if (value === undefined) return null
  return value ? 1 : 0
}

function interruptedFilter(sql: SqlClient.SqlClient, value: boolean | undefined) {
  if (value === undefined) return sql.literal('TRUE')
  const membership = sql`sessions.id IN (
    SELECT session_id FROM session_active_runs WHERE status = ${'interrupted'}
  )`
  return value ? membership : sql`NOT (${membership})`
}

function interruptedCountColumn(sql: SqlClient.SqlClient, value: boolean | undefined) {
  return value === undefined ? sql`NULL` : sql`COUNT(*) OVER ()`
}

function catalogSearchFilter(sql: SqlClient.SqlClient, searchText: string | undefined) {
  const query = searchText?.trim().toLowerCase() ?? ''
  if (query === '') return sql.literal('TRUE')
  if ([...query].length >= MINIMUM_TRIGRAM_SEARCH_LENGTH) {
    const ftsQuery = `"${query.replaceAll('"', '""')}"`
    return sql`sessions.id IN (
      SELECT session_id FROM session_catalog_search
      WHERE session_catalog_search MATCH ${ftsQuery}
    )`
  }
  const likeQuery = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  return sql`(
    lower(sessions.title) LIKE ${likeQuery} ESCAPE '\\'
    OR lower(COALESCE(sessions.project_path, '')) LIKE ${likeQuery} ESCAPE '\\'
  )`
}

function listResult(request: ListRequest, rows: readonly ListResultRow[]) {
  const page = rows.slice(0, request.query.limit)
  const last = page.at(-1)
  return sessionQueryResponse(request, {
    operation: 'list',
    sessions: page.map(sessionQuerySummary),
    ...(request.query.interrupted !== undefined && request.query.cursor === undefined
      ? { totalCount: rows[0]?.total_count ?? 0 }
      : {}),
    ...(rows.length > request.query.limit && last
      ? {
          nextCursor: encodeSessionQueryCursor({
            updatedAt: last.updated_at,
            sessionId: last.session_id,
          }),
        }
      : {}),
  })
}

export function listSessions(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: ListRequest,
) {
  const cursor = listCursor(request)
  if (cursor === 'invalid') return Effect.succeed(invalidSessionQueryCursor(request))
  const allowed = authorizedSessionScope(authority)
  const archived = archivedFilter(request.query.archived)
  const hasInterruptedRun = interruptedFilter(sql, request.query.interrupted)
  const searchFilter = catalogSearchFilter(sql, request.query.searchText)
  const workingPathFilter = request.query.workingPath
    ? sql`sessions.id IN (
        SELECT catalog_binding.session_id
        FROM workspace_resources AS catalog_workspace
        JOIN session_workspace_bindings AS catalog_binding
          ON catalog_binding.workspace_id = catalog_workspace.id
        WHERE catalog_workspace.working_path = ${request.query.workingPath}
      )`
    : sql.literal('TRUE')
  return Effect.gen(function* () {
    const rows = yield* sql<ListResultRow>`
      SELECT
        sessions.id AS session_id, sessions.title, sessions.project_path, sessions.archived,
        sessions.created_at, sessions.updated_at,
        session_spawn_lineage.parent_session_id,
        session_spawn_lineage.hive_root_session_id,
        (SELECT COUNT(*) FROM session_spawn_lineage AS direct_lineage
          WHERE direct_lineage.parent_session_id = sessions.id) AS direct_worker_count,
        session_execution_profiles.profile_json
        , delegation_contracts.id AS delegation_id
        , delegation_contracts.state AS delegation_state
        , ${interruptedCountColumn(sql, request.query.interrupted)} AS total_count
      FROM sessions
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      LEFT JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      LEFT JOIN delegation_contracts ON delegation_contracts.child_session_id = sessions.id
      WHERE (${archived} IS NULL OR sessions.archived = ${archived})
        AND (${request.query.projectPath ?? null} IS NULL
          OR sessions.project_path = ${request.query.projectPath ?? null})
        AND ${workingPathFilter}
        AND ${hasInterruptedRun}
        AND ${searchFilter}
        AND (${cursor?.updatedAt ?? null} IS NULL
          OR sessions.updated_at < ${cursor?.updatedAt ?? null}
          OR (sessions.updated_at = ${cursor?.updatedAt ?? null}
            AND sessions.id < ${cursor?.sessionId ?? null}))
        AND (
          ${allowed.all} = 1
          OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
          OR sessions.id IN ${sql.in(allowed.sessionIds)}
          OR COALESCE(session_spawn_lineage.hive_root_session_id, sessions.id)
            IN ${sql.in(allowed.hiveRootSessionIds)}
        )
      ORDER BY sessions.updated_at DESC, sessions.id DESC
      LIMIT ${request.query.limit + 1}
    `
    return listResult(request, rows)
  })
}
