import * as SqlClient from '@effect/sql/SqlClient'
import { hiveNextActor } from '@shared/domain/hive-next-actor'
import type { SessionId } from '@shared/types/brand'
import type { HivePendingRequest } from '@shared/types/hive-next-actor'
import type { SessionCatalogPage, SessionProjectPage, SessionSummary } from '@shared/types/session'
import type {
  HiveSessionCatalogPage,
  HiveTreeSessionCatalogPage,
} from '@shared/types/session-hive-catalog'
import * as Effect from 'effect/Effect'
import { loadHiveNextActorFacts } from '../../adapters/sqlite-hive-next-actor-facts'
import { runStoreEffect } from '../store-runtime'
import {
  attachArchivedBranchState,
  hydrateSessionRows,
  sessionIdsForQuery,
  sessionSummaryColumns,
} from './hydration'
import { hydrateSessionNavigationRows, loadArchivedBranchRows } from './session-list'
import { searchProjectPage } from './session-project-catalog-cache'
import type { SessionSummaryRow } from './types'

interface SessionCatalogCursor {
  readonly updatedAt: number
  readonly sessionId: string
}

function projectPathsPage(rows: readonly { readonly project_path: string }[], limit: number) {
  const paths = rows.slice(0, limit).map((row) => row.project_path)
  const lastPath = paths.at(-1)
  return {
    paths,
    ...(rows.length > limit && lastPath ? { nextCursor: lastPath } : {}),
  }
}

function queryUnfilteredProjectPage(
  sql: SqlClient.SqlClient,
  limit: number,
  afterPath: string | undefined,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly project_path: string }>`
      SELECT DISTINCT project_path
      FROM sessions INDEXED BY idx_sessions_project_catalog_cursor
      WHERE archived = 0 AND project_path IS NOT NULL AND project_path > ${afterPath ?? ''}
      ORDER BY project_path LIMIT ${limit + 1}
    `
    return projectPathsPage(rows, limit)
  })
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

/** Indexed keyset page over distinct project paths, including older Sessions. */
export async function listSessionProjectPage(
  limit: number,
  afterPath?: string,
  search?: string,
  matchingDisplayNamePaths: readonly string[] = [],
): Promise<SessionProjectPage> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return search
        ? yield* searchProjectPage(sql, limit, afterPath, search, matchingDisplayNamePaths)
        : yield* queryUnfilteredProjectPage(sql, limit, afterPath)
    }),
  )
}

/** Exact active-project authorization without hydrating an unbounded Session list. */
export async function hasActiveSessionProjectPath(paths: readonly string[]): Promise<boolean> {
  if (paths.length === 0) return false
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly project_path: string }>`
        SELECT project_path FROM sessions INDEXED BY idx_sessions_project_catalog_cursor
        WHERE project_path IN ${sql.in([...new Set(paths)])} AND archived = 0 LIMIT 1
      `
      return rows.length > 0
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
        SELECT COALESCE(live.parent_session_id, historical.parent_session_id)
          AS parent_session_id
        FROM sessions
        LEFT JOIN session_spawn_lineage AS live ON live.child_session_id = sessions.id
        LEFT JOIN session_lineage AS historical ON historical.session_id = sessions.id
        WHERE sessions.id = ${sessionId} LIMIT 1
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
        LEFT JOIN session_spawn_lineage AS live ON live.child_session_id = sessions.id
        LEFT JOIN session_lineage AS historical ON historical.session_id = sessions.id
        WHERE COALESCE(live.parent_session_id, historical.parent_session_id) = ${sessionId}
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

/**
 * How many live members, and the Queen, need the person (ADR 0059), across the whole Hive. The
 * stored facts load in one query; parked requests come from the Host. One rule decides it, the
 * one the panel's Needs you group uses.
 */
function countHiveNeedsYou(
  sql: SqlClient.SqlClient,
  rootId: string,
  pendingRequests: ReadonlyMap<string, HivePendingRequest>,
) {
  return Effect.gen(function* () {
    const members = yield* sql<{ readonly session_id: string }>`
      SELECT sessions.id AS session_id FROM sessions
      JOIN session_spawn_lineage AS live ON live.child_session_id = sessions.id
      WHERE live.hive_root_session_id = ${rootId}
        AND sessions.id != ${rootId}
        AND sessions.archived = 0
    `
    const memberIds = members.map((member) => member.session_id)
    const facts = yield* loadHiveNextActorFacts(sql, memberIds)
    const needsYou = [rootId, ...memberIds].filter(
      (id) =>
        hiveNextActor({ ...facts.get(id), pendingRequest: pendingRequests.get(id) ?? null })
          ?.nextActor === 'user',
    )
    return needsYou.length
  })
}

/** Keyset page of every Session of a Hive under its Queen, at any depth (ADR 0051). */
export async function listHiveTreeSessionCatalogPage(
  sessionId: SessionId,
  limit: number,
  encodedCursor?: string,
  pendingRequests: ReadonlyMap<string, HivePendingRequest> = new Map(),
): Promise<HiveTreeSessionCatalogPage> {
  const cursor = decodeCatalogCursor(encodedCursor)
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const roots = yield* sql<{ readonly root_id: string | null }>`
        SELECT COALESCE(live.hive_root_session_id, sessions.id) AS root_id
        FROM sessions
        LEFT JOIN session_spawn_lineage AS live ON live.child_session_id = sessions.id
        WHERE sessions.id = ${sessionId} LIMIT 1
      `
      const rootId = roots[0]?.root_id
      if (!rootId) return { root: null, members: [], needsYouCount: 0 }
      const rootRows = yield* loadSessionRowsById(sql, [rootId])
      // Hydrated like every member, so the root carries its lineage (role, Worker counts).
      const root = (yield* hydrateSessionNavigationRows(sql, rootRows))[0] ?? null
      const memberRows = yield* sql<SessionSummaryRow>`
        SELECT ${sessionSummaryColumns(sql, 'sessions')} FROM sessions
        JOIN session_spawn_lineage AS live ON live.child_session_id = sessions.id
        WHERE live.hive_root_session_id = ${rootId}
          AND sessions.id != ${rootId}
          AND (${cursor?.updatedAt ?? null} IS NULL
            OR sessions.updated_at < ${cursor?.updatedAt ?? null}
            OR (sessions.updated_at = ${cursor?.updatedAt ?? null}
              AND sessions.id < ${cursor?.sessionId ?? null}))
        ORDER BY sessions.updated_at DESC, sessions.id DESC LIMIT ${limit + 1}
      `
      const memberPage = catalogPage(yield* hydrateSessionNavigationRows(sql, memberRows), limit)
      const needsYouCount = yield* countHiveNeedsYou(sql, rootId, pendingRequests)
      return {
        root,
        members: memberPage.sessions,
        needsYouCount,
        ...(memberPage.nextCursor ? { nextCursor: memberPage.nextCursor } : {}),
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
