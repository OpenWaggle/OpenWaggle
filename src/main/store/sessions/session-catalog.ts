import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type {
  HiveSessionCatalogPage,
  SessionCatalogPage,
  SessionSummary,
} from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import {
  attachArchivedBranchState,
  hydrateSessionRows,
  sessionIdsForQuery,
  sessionSummaryColumns,
} from './hydration'
import { hydrateSessionNavigationRows, loadArchivedBranchRows } from './session-list'
import type { SessionSummaryRow } from './types'

interface SessionCatalogCursor {
  readonly updatedAt: number
  readonly sessionId: string
}

function decodeCatalogCursor(cursor?: string): SessionCatalogCursor | null {
  if (!cursor) return null
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      typeof value !== 'object' ||
      value === null ||
      !('updatedAt' in value) ||
      typeof value.updatedAt !== 'number' ||
      !('sessionId' in value) ||
      typeof value.sessionId !== 'string'
    ) {
      throw new Error('invalid shape')
    }
    return { updatedAt: value.updatedAt, sessionId: value.sessionId }
  } catch {
    throw new Error('Session catalog cursor is invalid.')
  }
}

function encodeCatalogCursor(session: SessionSummary) {
  return Buffer.from(
    JSON.stringify({ updatedAt: session.updatedAt, sessionId: String(session.id) }),
  ).toString('base64url')
}

function catalogPage(sessions: readonly SessionSummary[], limit: number): SessionCatalogPage {
  const page = sessions.slice(0, limit)
  const last = page.at(-1)
  return {
    sessions: page,
    ...(sessions.length > limit && last ? { nextCursor: encodeCatalogCursor(last) } : {}),
  }
}

function loadSessionRowsById(sql: SqlClient.SqlClient, sessionIds: readonly string[]) {
  const emptyRows: readonly SessionSummaryRow[] = []
  if (sessionIds.length === 0) return Effect.succeed(emptyRows)
  return sql<SessionSummaryRow>`
    SELECT ${sessionSummaryColumns(sql)} FROM sessions WHERE id IN ${sql.in(sessionIds)}
  `
}

export async function listSessionCatalogPage(
  archived: boolean,
  limit: number,
  encodedCursor?: string,
): Promise<SessionCatalogPage> {
  const cursor = decodeCatalogCursor(encodedCursor)
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<SessionSummaryRow>`
        SELECT ${sessionSummaryColumns(sql)} FROM sessions
        WHERE archived = ${archived ? 1 : 0}
          AND (${cursor?.updatedAt ?? null} IS NULL
            OR updated_at < ${cursor?.updatedAt ?? null}
            OR (updated_at = ${cursor?.updatedAt ?? null} AND id < ${cursor?.sessionId ?? null}))
        ORDER BY updated_at DESC, id DESC LIMIT ${limit + 1}
      `
      return catalogPage(yield* hydrateSessionNavigationRows(sql, rows), limit)
    }),
  )
}

export async function listSessionsByIds(sessionIds: readonly SessionId[]) {
  if (sessionIds.length === 0) return []
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* hydrateSessionNavigationRows(
        sql,
        yield* loadSessionRowsById(sql, sessionIds.map(String)),
      )
      const byId = new Map(sessions.map((session) => [session.id, session]))
      return sessionIds.flatMap((id) => {
        const session = byId.get(id)
        return session ? [session] : []
      })
    }),
  )
}

export async function listHiveSessionCatalogPage(
  sessionId: SessionId,
  limit: number,
  encodedCursor?: string,
): Promise<HiveSessionCatalogPage> {
  const cursor = decodeCatalogCursor(encodedCursor)
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const parents = yield* sql<{ readonly parent_session_id: string | null }>`
        SELECT parent_session_id FROM session_spawn_lineage
        WHERE child_session_id = ${sessionId} LIMIT 1
      `
      const contextIds = [
        String(sessionId),
        ...(parents[0]?.parent_session_id ? [parents[0].parent_session_id] : []),
      ]
      const context = yield* hydrateSessionNavigationRows(
        sql,
        yield* loadSessionRowsById(sql, contextIds),
      )
      const rows = yield* sql<SessionSummaryRow>`
        SELECT ${sessionSummaryColumns(sql, 'sessions')} FROM sessions
        JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
        WHERE session_spawn_lineage.parent_session_id = ${sessionId}
          AND (${cursor?.updatedAt ?? null} IS NULL
            OR sessions.updated_at < ${cursor?.updatedAt ?? null}
            OR (sessions.updated_at = ${cursor?.updatedAt ?? null}
              AND sessions.id < ${cursor?.sessionId ?? null}))
        ORDER BY sessions.updated_at DESC, sessions.id DESC LIMIT ${limit + 1}
      `
      const workerPage = catalogPage(yield* hydrateSessionNavigationRows(sql, rows), limit)
      return {
        context,
        workers: workerPage.sessions,
        ...(workerPage.nextCursor ? { nextCursor: workerPage.nextCursor } : {}),
      }
    }),
  )
}

/** Keyset page of active Sessions that contain at least one archived branch. */
export async function listArchivedSessionBranchCatalogPage(
  limit: number,
  encodedCursor?: string,
): Promise<SessionCatalogPage> {
  const cursor = decodeCatalogCursor(encodedCursor)
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<SessionSummaryRow>`
        SELECT ${sessionSummaryColumns(sql)} FROM sessions
        WHERE archived = 0
          AND EXISTS (
            SELECT 1 FROM session_branches
            WHERE session_branches.session_id = sessions.id
              AND session_branches.archived_at IS NOT NULL
          )
          AND (${cursor?.updatedAt ?? null} IS NULL
            OR updated_at < ${cursor?.updatedAt ?? null}
            OR (updated_at = ${cursor?.updatedAt ?? null} AND id < ${cursor?.sessionId ?? null}))
        ORDER BY updated_at DESC, id DESC LIMIT ${limit + 1}
      `
      const page = catalogPage(hydrateSessionRows(rows) ?? [], limit)
      if (page.sessions.length === 0) return page
      return {
        ...page,
        sessions: attachArchivedBranchState(
          page.sessions,
          yield* loadArchivedBranchRows(sql, sessionIdsForQuery(page.sessions)),
        ),
      }
    }),
  )
}
