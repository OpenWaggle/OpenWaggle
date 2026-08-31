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

function listResult(request: ListRequest, rows: readonly SessionQuerySummaryRow[]) {
  const page = rows.slice(0, request.query.limit)
  const last = page.at(-1)
  return sessionQueryResponse(request, {
    operation: 'list',
    sessions: page.map(sessionQuerySummary),
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
  return Effect.gen(function* () {
    const rows = yield* sql<SessionQuerySummaryRow>`
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
      FROM sessions
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      LEFT JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      LEFT JOIN delegation_contracts ON delegation_contracts.child_session_id = sessions.id
      WHERE (${archived} IS NULL OR sessions.archived = ${archived})
        AND (${request.query.projectPath ?? null} IS NULL
          OR sessions.project_path = ${request.query.projectPath ?? null})
        AND (${request.query.workingPath ?? null} IS NULL OR EXISTS (
          SELECT 1
          FROM session_workspace_bindings AS catalog_binding
          JOIN workspace_resources AS catalog_workspace
            ON catalog_workspace.id = catalog_binding.workspace_id
          WHERE catalog_binding.session_id = sessions.id
            AND catalog_workspace.working_path = ${request.query.workingPath ?? null}
        ))
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
