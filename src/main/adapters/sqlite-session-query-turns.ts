import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import {
  decodeSessionQueryCursor,
  encodeSessionQueryCursor,
  invalidSessionQueryCursor,
  sessionQueryResponse,
} from './sqlite-session-query-support'

type TurnsRequest = SessionQueryRequest & {
  readonly query: Extract<SessionQueryRequest['query'], { operation: 'turns' }>
}

export function readTurns(sql: SqlClient.SqlClient, request: TurnsRequest) {
  const cursor = decodeSessionQueryCursor(request.query.cursor)
  if (cursor === 'invalid') return Effect.succeed(invalidSessionQueryCursor(request))
  const runCursor =
    cursor && typeof cursor.createdAt === 'number' && typeof cursor.runId === 'string'
      ? { createdAt: cursor.createdAt, runId: cursor.runId }
      : cursor
        ? 'invalid'
        : null
  if (runCursor === 'invalid') return Effect.succeed(invalidSessionQueryCursor(request))
  return Effect.gen(function* () {
    const sessions = yield* sql<{ readonly found: number }>`
      SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ${request.query.sessionId}) AS found
    `
    if (sessions[0]?.found !== 1) {
      return sessionQueryResponse(request, {
        operation: 'turns',
        error: { code: 'session_not_found', message: 'Session not found.' },
      })
    }
    const rows = yield* sql<{
      readonly run_id: string
      readonly status: string
      readonly created_at: number
      readonly updated_at: number
      readonly node_count: number
      readonly first_created_order: number | null
      readonly last_created_order: number | null
    }>`
      SELECT runs.id AS run_id, runs.status, runs.created_at, runs.updated_at,
        COUNT(nodes.id) AS node_count,
        MIN(nodes.created_order) AS first_created_order,
        MAX(nodes.created_order) AS last_created_order
      FROM session_runs AS runs
      LEFT JOIN session_nodes AS nodes
        ON nodes.session_id = runs.session_id
        AND json_extract(nodes.metadata_json, '$.openWaggle.runId') = runs.id
      WHERE runs.session_id = ${request.query.sessionId}
        AND (${runCursor?.createdAt ?? null} IS NULL
          OR runs.created_at < ${runCursor?.createdAt ?? null}
          OR (runs.created_at = ${runCursor?.createdAt ?? null}
            AND runs.id < ${runCursor?.runId ?? null}))
      GROUP BY runs.id
      ORDER BY runs.created_at DESC, runs.id DESC
      LIMIT ${request.query.limit + 1}
    `
    const page = rows.slice(0, request.query.limit)
    const last = page.at(-1)
    return sessionQueryResponse(request, {
      operation: 'turns',
      sessionId: request.query.sessionId,
      turns: page.map((row) => ({
        runId: row.run_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        nodeCount: row.node_count,
        ...(row.first_created_order === null ? {} : { firstCreatedOrder: row.first_created_order }),
        ...(row.last_created_order === null ? {} : { lastCreatedOrder: row.last_created_order }),
      })),
      ...(rows.length > request.query.limit && last
        ? {
            nextCursor: encodeSessionQueryCursor({
              createdAt: last.created_at,
              runId: last.run_id,
            }),
          }
        : {}),
    })
  })
}
