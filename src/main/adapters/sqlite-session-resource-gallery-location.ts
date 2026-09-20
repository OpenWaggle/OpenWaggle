import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type {
  SessionResourceImageLocation,
  SessionResourceRouteSelection,
} from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import {
  activeCatalogPath,
  catalogIdentity,
  hydrateResources,
  type SessionResourceCatalogIdentity,
} from './sqlite-session-resource-catalog-shared'
import type { SessionResourceRow } from './sqlite-session-resource-codec'

interface ImageLocationRow {
  readonly total: number
  readonly image_index: number
  readonly previous_id: string | null
  readonly next_id: string | null
}

function findImageLocationRow(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  resourceId: string,
  identity: SessionResourceCatalogIdentity,
) {
  const activeBranch = identity.branch ?? '__openwaggle:no-active-branch__'
  return sql<ImageLocationRow>`
    WITH RECURSIVE active_path(node_id) AS (
      ${activeCatalogPath(sql, sessionId, identity)}
    ), ordered_images AS (
      SELECT
        resource.id,
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
    ), anchor AS (
      SELECT id, sort_group, sort_at
      FROM ordered_images
      WHERE id = ${resourceId}
    )
    SELECT
      (SELECT COUNT(*) FROM ordered_images) AS total,
      (
        SELECT COUNT(*)
        FROM ordered_images candidate, anchor
        WHERE candidate.sort_group < anchor.sort_group
           OR (candidate.sort_group = anchor.sort_group AND candidate.sort_at < anchor.sort_at)
           OR (
             candidate.sort_group = anchor.sort_group
             AND candidate.sort_at = anchor.sort_at
             AND candidate.id < anchor.id
           )
      ) AS image_index,
      (
        SELECT candidate.id
        FROM ordered_images candidate, anchor
        WHERE candidate.sort_group < anchor.sort_group
           OR (candidate.sort_group = anchor.sort_group AND candidate.sort_at < anchor.sort_at)
           OR (
             candidate.sort_group = anchor.sort_group
             AND candidate.sort_at = anchor.sort_at
             AND candidate.id < anchor.id
           )
        ORDER BY candidate.sort_group DESC, candidate.sort_at DESC, candidate.id DESC
        LIMIT 1
      ) AS previous_id,
      (
        SELECT candidate.id
        FROM ordered_images candidate, anchor
        WHERE candidate.sort_group > anchor.sort_group
           OR (candidate.sort_group = anchor.sort_group AND candidate.sort_at > anchor.sort_at)
           OR (
             candidate.sort_group = anchor.sort_group
             AND candidate.sort_at = anchor.sort_at
             AND candidate.id > anchor.id
           )
        ORDER BY candidate.sort_group ASC, candidate.sort_at ASC, candidate.id ASC
        LIMIT 1
      ) AS next_id
    FROM anchor
  `
}

function loadImageRows(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  resourceId: string,
  location: ImageLocationRow,
) {
  const orderedIds = [location.previous_id, resourceId, location.next_id].filter(
    (id): id is string => id !== null,
  )
  return sql<SessionResourceRow>`
    SELECT
      id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
      available, is_source, is_output, created_at, updated_at
    FROM session_resources
    WHERE session_id = ${sessionId} AND id IN ${sql.in(orderedIds)}
  `
}

export function locateSessionImage(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  resourceId: string,
  selection: SessionResourceRouteSelection | null = null,
) {
  return Effect.gen(function* () {
    const identity = yield* catalogIdentity(sql, sessionId, selection)
    const location = (yield* findImageLocationRow(sql, sessionId, resourceId, identity))[0]
    if (!location) return null
    const rows = yield* loadImageRows(sql, sessionId, resourceId, location)
    const hydrated = yield* hydrateResources(sql, sessionId, rows, 'images', identity)
    const byId = new Map(hydrated.map((resource) => [resource.id, resource]))
    const resource = byId.get(resourceId)
    if (!resource) return null
    return {
      resource,
      previous: location.previous_id ? (byId.get(location.previous_id) ?? null) : null,
      next: location.next_id ? (byId.get(location.next_id) ?? null) : null,
      index: location.image_index,
      total: location.total,
      orderRevision: identity.revision,
    } satisfies SessionResourceImageLocation
  })
}
