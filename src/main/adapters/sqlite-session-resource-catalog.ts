import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type {
  SessionResourceCatalogPage,
  SessionResourceCatalogPageRequest,
  SessionResourceCatalogView,
  SessionResourceKind,
  SessionResourceRouteSelection,
} from '@shared/types/session-resource'
import { SESSION_RESOURCE_CATALOG_STALE_MESSAGE } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceCatalogCursorError } from '../errors'
import {
  type BrowserCursor,
  boundedCatalogLimit,
  catalogIdentity,
  decodeCatalogCursor,
  encodeCatalogCursor,
  hydrateResources,
  resourceFilter,
  type SessionResourceCatalogIdentity,
} from './sqlite-session-resource-catalog-shared'
import type { SessionResourceRow } from './sqlite-session-resource-codec'
import { imagePage } from './sqlite-session-resource-gallery-page'

export { locateSessionImage } from './sqlite-session-resource-gallery-location'
export {
  findExistingOccurrences,
  listManagedResourceNodeIds,
  listResourcesByNodeIds,
  listResourcesByNodeIdsPage,
} from './sqlite-session-resource-node-catalog'

function browserPage(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  input: SessionResourceCatalogPageRequest,
  identity: SessionResourceCatalogIdentity,
  cursor: BrowserCursor | null,
) {
  const limit = boundedCatalogLimit(input.limit)
  const afterCursor = cursor
    ? sql`
        AND (
          updated_at < ${cursor.updatedAt}
          OR (updated_at = ${cursor.updatedAt} AND id > ${cursor.id})
        )
      `
    : sql.literal('')
  return Effect.gen(function* () {
    const totals = yield* sql<{ readonly total: number }>`
      SELECT COUNT(*) AS total
      FROM session_resources
      WHERE session_id = ${sessionId}
        AND ${resourceFilter(sql, input.view)}
    `
    const rows = yield* sql<SessionResourceRow>`
      SELECT
        id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
        available, is_source, is_output, created_at, updated_at
      FROM session_resources
      WHERE session_id = ${sessionId}
        AND ${resourceFilter(sql, input.view)}
        ${afterCursor}
      ORDER BY updated_at DESC, id ASC
      LIMIT ${limit + 1}
    `
    const pageRows = rows.slice(0, limit)
    const resources = yield* hydrateResources(sql, sessionId, pageRows, input.view, identity)
    const last = pageRows.at(-1)
    return {
      resources,
      total: totals[0]?.total ?? 0,
      nextCursor:
        rows.length > limit && last
          ? encodeCatalogCursor({
              version: 1,
              view: input.view === 'images' ? 'all' : input.view,
              revision: identity.revision,
              updatedAt: last.updated_at,
              id: last.id,
            })
          : null,
      orderRevision: identity.revision,
    } satisfies SessionResourceCatalogPage
  })
}

export function listResourcePage(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  input: SessionResourceCatalogPageRequest,
) {
  return Effect.gen(function* () {
    const identity = yield* catalogIdentity(sql, sessionId, input.selection ?? null)
    const cursor = yield* Effect.try({
      try: () => decodeCatalogCursor(input.cursor, input.view, identity.revision),
      catch: () =>
        new SessionResourceCatalogCursorError({
          message: SESSION_RESOURCE_CATALOG_STALE_MESSAGE,
        }),
    })
    if (input.view === 'images') {
      return yield* imagePage(
        sql,
        sessionId,
        input,
        identity,
        cursor?.view === 'images' ? cursor : null,
      )
    }
    return yield* browserPage(
      sql,
      sessionId,
      input,
      identity,
      cursor?.view === 'images' ? null : cursor,
    )
  })
}

export function findResourceById(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  resourceId: string,
  view: SessionResourceCatalogView,
  selection: SessionResourceRouteSelection | null = null,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<SessionResourceRow>`
      SELECT
        id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
        available, is_source, is_output, created_at, updated_at
      FROM session_resources
      WHERE session_id = ${sessionId} AND id = ${resourceId}
        AND ${resourceFilter(sql, view)}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    const identity = yield* catalogIdentity(sql, sessionId, selection)
    return (yield* hydrateResources(sql, sessionId, [row], view, identity))[0] ?? null
  })
}

export function findResourceByOccurrence(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  occurrenceId: string,
  view: SessionResourceCatalogView,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly resource_id: string }>`
      SELECT occurrence.resource_id
      FROM session_resource_occurrences occurrence
      INNER JOIN session_resources resource ON resource.id = occurrence.resource_id
      WHERE resource.session_id = ${sessionId} AND occurrence.id = ${occurrenceId}
      LIMIT 1
    `
    const resourceId = rows[0]?.resource_id
    return resourceId ? yield* findResourceById(sql, sessionId, resourceId, view) : null
  })
}

export function findResourceByLocator(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  kind: SessionResourceKind,
  locator: string,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly id: string }>`
      SELECT id FROM session_resources
      WHERE session_id = ${sessionId} AND kind = ${kind} AND locator = ${locator}
      ORDER BY updated_at DESC, id ASC
      LIMIT 1
    `
    const resourceId = rows[0]?.id
    return resourceId ? yield* findResourceById(sql, sessionId, resourceId, 'all') : null
  })
}
