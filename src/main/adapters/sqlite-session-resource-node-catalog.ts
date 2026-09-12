import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type {
  SessionResourceCatalogPage,
  SessionResourceNodePageRequest,
} from '@shared/types/session-resource'
import { SESSION_RESOURCE_CATALOG_STALE_MESSAGE } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceCatalogCursorError } from '../errors'
import {
  catalogIdentity,
  decodeNodeCursor,
  encodeCatalogCursor,
  nodeQuerySignature,
  SESSION_RESOURCE_TARGETED_LIMIT,
} from './sqlite-session-resource-catalog-shared'
import type { SessionResourceRow } from './sqlite-session-resource-codec'
import { rowToResource, type SessionResourceOccurrenceRow } from './sqlite-session-resource-codec'

const SESSION_RESOURCE_LOOKUP_CHUNK = 200

export function findExistingOccurrences(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  occurrenceIds: readonly string[],
) {
  return Effect.gen(function* () {
    const result = new Set<string>()
    for (let offset = 0; offset < occurrenceIds.length; offset += SESSION_RESOURCE_LOOKUP_CHUNK) {
      const chunk = occurrenceIds.slice(offset, offset + SESSION_RESOURCE_LOOKUP_CHUNK)
      if (chunk.length === 0) continue
      const rows = yield* sql<{ readonly id: string }>`
        SELECT occurrence.id
        FROM session_resource_occurrences occurrence
        INNER JOIN session_resources resource ON resource.id = occurrence.resource_id
        WHERE resource.session_id = ${sessionId}
          AND occurrence.id IN ${sql.in(chunk)}
      `
      for (const row of rows) result.add(row.id)
    }
    return result
  })
}

function hydrateRequestedNodeOccurrences(
  sql: SqlClient.SqlClient,
  rows: readonly SessionResourceRow[],
  nodeIds: readonly string[],
  activeBranch: string | null,
) {
  if (rows.length === 0 || nodeIds.length === 0) return Effect.succeed([])
  const branch = activeBranch ?? '__openwaggle:no-active-branch__'
  return Effect.map(
    sql<SessionResourceOccurrenceRow>`
      WITH ranked_occurrences AS (
        SELECT
          id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at,
          ROW_NUMBER() OVER (
            PARTITION BY resource_id, node_id
            ORDER BY CASE WHEN branch_id = ${branch} THEN 0 ELSE 1 END ASC,
              created_at DESC, id DESC
          ) AS occurrence_rank
        FROM session_resource_occurrences
        WHERE resource_id IN ${sql.in(rows.map(({ id }) => id))}
          AND node_id IN ${sql.in(nodeIds)}
      )
      SELECT id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at
      FROM ranked_occurrences
      WHERE occurrence_rank = 1
      ORDER BY resource_id ASC, created_at ASC, id ASC
    `,
    (occurrenceRows) => {
      const byResource = new Map<string, SessionResourceOccurrenceRow[]>()
      for (const occurrence of occurrenceRows) {
        const existing = byResource.get(occurrence.resource_id)
        if (existing) existing.push(occurrence)
        else byResource.set(occurrence.resource_id, [occurrence])
      }
      return rows.map((row) => rowToResource(row, byResource.get(row.id) ?? []))
    },
  )
}

export function listResourcesByNodeIdsPage(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  input: SessionResourceNodePageRequest,
) {
  return Effect.gen(function* () {
    const nodeIds = [...new Set(input.nodeIds)]
    const { branch, revision } = yield* catalogIdentity(sql, sessionId)
    if (nodeIds.length === 0) {
      return {
        resources: [],
        total: 0,
        nextCursor: null,
        orderRevision: revision,
      } satisfies SessionResourceCatalogPage
    }
    const signature = nodeQuerySignature(nodeIds, input.kind)
    const cursor = yield* Effect.try({
      try: () => decodeNodeCursor(input.cursor, revision, signature),
      catch: () =>
        new SessionResourceCatalogCursorError({
          message: SESSION_RESOURCE_CATALOG_STALE_MESSAGE,
        }),
    })
    const limit = Math.min(SESSION_RESOURCE_TARGETED_LIMIT, Math.max(1, Math.trunc(input.limit)))
    const afterCursor = cursor
      ? sql`
          AND (
            resource.created_at > ${cursor.createdAt}
            OR (resource.created_at = ${cursor.createdAt} AND resource.id > ${cursor.id})
          )
        `
      : sql.literal('')
    const kindFilter = input.kind ? sql`resource.kind = ${input.kind}` : sql.literal('1 = 1')
    const totals = yield* sql<{ readonly total: number }>`
      SELECT COUNT(*) AS total
      FROM session_resources resource
      WHERE resource.session_id = ${sessionId}
        AND ${kindFilter}
        AND EXISTS (
          SELECT 1 FROM session_resource_occurrences occurrence
          WHERE occurrence.resource_id = resource.id
            AND occurrence.node_id IN ${sql.in(nodeIds)}
        )
    `
    const rows = yield* sql<SessionResourceRow>`
      SELECT
        resource.id, resource.session_id, resource.canonical_key, resource.kind,
        resource.title, resource.mime_type, resource.locator, resource.managed_path,
        resource.available, resource.is_source, resource.is_output,
        resource.created_at, resource.updated_at
      FROM session_resources resource
      WHERE resource.session_id = ${sessionId}
        AND ${kindFilter}
        AND EXISTS (
          SELECT 1 FROM session_resource_occurrences occurrence
          WHERE occurrence.resource_id = resource.id
            AND occurrence.node_id IN ${sql.in(nodeIds)}
        )
        ${afterCursor}
      ORDER BY resource.created_at ASC, resource.id ASC
      LIMIT ${limit + 1}
    `
    const pageRows = rows.slice(0, limit)
    const resources = yield* hydrateRequestedNodeOccurrences(sql, pageRows, nodeIds, branch)
    const last = pageRows.at(-1)
    return {
      resources,
      total: totals[0]?.total ?? 0,
      nextCursor:
        rows.length > limit && last
          ? encodeCatalogCursor({
              version: 1,
              view: 'nodes',
              revision,
              signature,
              createdAt: last.created_at,
              id: last.id,
            })
          : null,
      orderRevision: revision,
    } satisfies SessionResourceCatalogPage
  })
}

export function listResourcesByNodeIds(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  nodeIds: readonly string[],
  kind: SessionResourceNodePageRequest['kind'],
  requestedLimit: number,
) {
  return Effect.map(
    listResourcesByNodeIdsPage(sql, sessionId, { nodeIds, kind, limit: requestedLimit }),
    ({ resources }) => resources,
  )
}

export function listManagedResourceNodeIds(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  requestedLimit: number,
) {
  const limit = Math.min(SESSION_RESOURCE_TARGETED_LIMIT, Math.max(1, requestedLimit))
  return Effect.map(
    sql<{ readonly node_id: string }>`
      SELECT DISTINCT occurrence.node_id
      FROM session_resources resource
      INNER JOIN session_resource_occurrences occurrence ON occurrence.resource_id = resource.id
      WHERE resource.session_id = ${sessionId}
        AND resource.available = 1
        AND resource.managed_path IS NOT NULL
        AND occurrence.node_id IS NOT NULL
      ORDER BY resource.updated_at DESC, occurrence.created_at DESC
      LIMIT ${limit}
    `,
    (rows) => rows.map(({ node_id }) => node_id),
  )
}
