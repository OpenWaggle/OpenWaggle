import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type {
  SessionResourceCatalogPage,
  SessionResourceCatalogPageRequest,
} from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import {
  activeCatalogPath,
  boundedCatalogLimit,
  type CatalogResourceRow,
  encodeCatalogCursor,
  hydrateResources,
  type ImageCursor,
  type SessionResourceCatalogIdentity,
} from './sqlite-session-resource-catalog-shared'

export function imagePage(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  input: SessionResourceCatalogPageRequest,
  identity: SessionResourceCatalogIdentity,
  cursor: ImageCursor | null,
) {
  const limit = boundedCatalogLimit(input.limit)
  const activeBranch = identity.branch ?? '__openwaggle:no-active-branch__'
  const afterCursor = cursor
    ? sql`
        WHERE (
          sort_group > ${cursor.group}
          OR (sort_group = ${cursor.group} AND sort_at > ${cursor.orderAt})
          OR (sort_group = ${cursor.group} AND sort_at = ${cursor.orderAt} AND id > ${cursor.id})
        )
      `
    : sql.literal('')
  return Effect.gen(function* () {
    const totals = yield* sql<{ readonly total: number }>`
      SELECT COUNT(*) AS total
      FROM session_resources
      WHERE session_id = ${sessionId}
        AND kind = 'image'
        AND (locator IS NULL OR locator NOT LIKE 'http://%')
        AND (available = 1 OR locator LIKE 'https://%')
    `
    const rows = yield* sql<CatalogResourceRow>`
      WITH RECURSIVE active_path(node_id) AS (
        ${activeCatalogPath(sql, sessionId, identity)}
      ), ordered_images AS (
        SELECT
          resource.id,
          resource.session_id,
          resource.canonical_key,
          resource.kind,
          resource.title,
          resource.mime_type,
          resource.locator,
          resource.managed_path,
          resource.available,
          resource.is_source,
          resource.is_output,
          resource.created_at,
          resource.updated_at,
          CASE WHEN EXISTS (
            SELECT 1
            FROM session_resource_occurrences active_occurrence
            WHERE active_occurrence.resource_id = resource.id
              AND (
                active_occurrence.node_id IN (SELECT node_id FROM active_path)
                OR (
                  active_occurrence.branch_id = ${activeBranch}
                  AND (
                    active_occurrence.node_id IS NULL
                    OR NOT EXISTS (SELECT 1 FROM active_path)
                  )
                )
              )
          ) THEN 0 ELSE 1 END AS sort_group,
          COALESCE((
            SELECT MIN(active_occurrence.created_at)
            FROM session_resource_occurrences active_occurrence
            WHERE active_occurrence.resource_id = resource.id
              AND (
                active_occurrence.node_id IN (SELECT node_id FROM active_path)
                OR (
                  active_occurrence.branch_id = ${activeBranch}
                  AND (
                    active_occurrence.node_id IS NULL
                    OR NOT EXISTS (SELECT 1 FROM active_path)
                  )
                )
              )
          ), resource.created_at) AS sort_at
        FROM session_resources resource
        WHERE resource.session_id = ${sessionId}
          AND resource.kind = 'image'
          AND (resource.locator IS NULL OR resource.locator NOT LIKE 'http://%')
          AND (resource.available = 1 OR resource.locator LIKE 'https://%')
      )
      SELECT * FROM ordered_images
      ${afterCursor}
      ORDER BY sort_group ASC, sort_at ASC, id ASC
      LIMIT ${limit + 1}
    `
    const pageRows = rows.slice(0, limit)
    const resources = yield* hydrateResources(sql, sessionId, pageRows, 'images', identity)
    const last = pageRows.at(-1)
    return {
      resources,
      total: totals[0]?.total ?? 0,
      nextCursor:
        rows.length > limit && last
          ? encodeCatalogCursor({
              version: 1,
              view: 'images',
              revision: identity.revision,
              group: last.sort_group ?? 1,
              orderAt: last.sort_at ?? last.created_at,
              id: last.id,
            })
          : null,
      orderRevision: identity.revision,
    } satisfies SessionResourceCatalogPage
  })
}
