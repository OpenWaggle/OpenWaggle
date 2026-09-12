import { createHash } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type {
  SessionResourceCatalogView,
  SessionResourceKind,
} from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import {
  rowToResource,
  type SessionResourceOccurrenceRow,
  type SessionResourceRow,
} from './sqlite-session-resource-codec'
import {
  activeCatalogPath,
  type SessionResourceCatalogIdentity,
} from './sqlite-session-resource-route-selection'

export {
  activeCatalogPath,
  catalogIdentity,
  type SessionResourceCatalogIdentity,
} from './sqlite-session-resource-route-selection'

export const SESSION_RESOURCE_OCCURRENCE_PREVIEW_LIMIT = 8
export const SESSION_RESOURCE_PAGE_LIMIT = 100
export const SESSION_RESOURCE_TARGETED_LIMIT = 512

export interface BrowserCursor {
  readonly version: 1
  readonly view: 'all' | 'sources' | 'outputs' | 'change-requests'
  readonly revision: string
  readonly updatedAt: number
  readonly id: string
}

export interface ImageCursor {
  readonly version: 1
  readonly view: 'images'
  readonly revision: string
  readonly group: number
  readonly orderAt: number
  readonly id: string
}

export interface NodeCursor {
  readonly version: 1
  readonly view: 'nodes'
  readonly revision: string
  readonly signature: string
  readonly createdAt: number
  readonly id: string
}

export interface CatalogResourceRow extends SessionResourceRow {
  readonly sort_group?: number
  readonly sort_at?: number
}

type CatalogCursor = BrowserCursor | ImageCursor

export function boundedCatalogLimit(limit: number) {
  if (!Number.isFinite(limit)) return SESSION_RESOURCE_PAGE_LIMIT
  return Math.min(SESSION_RESOURCE_PAGE_LIMIT, Math.max(1, Math.trunc(limit)))
}

export function encodeCatalogCursor(cursor: CatalogCursor | NodeCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function hasCursorBase(
  parsed: unknown,
  view: SessionResourceCatalogView | 'nodes',
  revision: string,
): parsed is {
  readonly version: 1
  readonly view: SessionResourceCatalogView | 'nodes'
  readonly revision: string
  readonly id: string
} {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    'version' in parsed &&
    parsed.version === 1 &&
    'view' in parsed &&
    parsed.view === view &&
    'revision' in parsed &&
    parsed.revision === revision &&
    'id' in parsed &&
    typeof parsed.id === 'string'
  )
}

function imageCursorFrom(parsed: unknown, revision: string): ImageCursor {
  if (
    !hasCursorBase(parsed, 'images', revision) ||
    !('group' in parsed) ||
    typeof parsed.group !== 'number' ||
    !('orderAt' in parsed) ||
    typeof parsed.orderAt !== 'number'
  ) {
    throw new Error('Session image catalog cursor is invalid.')
  }
  return {
    version: 1,
    view: 'images',
    revision,
    group: parsed.group,
    orderAt: parsed.orderAt,
    id: parsed.id,
  }
}

function browserCursorFrom(
  parsed: unknown,
  view: BrowserCursor['view'],
  revision: string,
): BrowserCursor {
  if (
    !hasCursorBase(parsed, view, revision) ||
    !('updatedAt' in parsed) ||
    typeof parsed.updatedAt !== 'number'
  ) {
    throw new Error('Session resource catalog cursor is invalid.')
  }
  return { version: 1, view, revision, updatedAt: parsed.updatedAt, id: parsed.id }
}

export function decodeCatalogCursor(
  raw: string | null | undefined,
  view: SessionResourceCatalogView,
  revision: string,
): CatalogCursor | null {
  if (!raw) return null
  const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  if (view === 'images') return imageCursorFrom(parsed, revision)
  return browserCursorFrom(parsed, view, revision)
}

export function nodeQuerySignature(nodeIds: readonly string[], kind: SessionResourceKind | null) {
  const hash = createHash('sha256')
  hash.update(kind ?? 'all')
  for (const nodeId of nodeIds) {
    hash.update('\0')
    hash.update(nodeId)
  }
  return hash.digest('base64url')
}

export function decodeNodeCursor(
  raw: string | null | undefined,
  revision: string,
  signature: string,
): NodeCursor | null {
  if (!raw) return null
  const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  if (
    !hasCursorBase(parsed, 'nodes', revision) ||
    !('signature' in parsed) ||
    parsed.signature !== signature ||
    !('createdAt' in parsed) ||
    typeof parsed.createdAt !== 'number'
  ) {
    throw new Error('Session resource node cursor is stale or invalid.')
  }
  return {
    version: 1,
    view: 'nodes',
    revision,
    signature,
    createdAt: parsed.createdAt,
    id: parsed.id,
  }
}

export function activityFilter(sql: SqlClient.SqlClient, view: SessionResourceCatalogView) {
  if (view === 'sources') return sql.literal("activity IN ('provided', 'read')")
  if (view === 'outputs') return sql.literal("activity IN ('created', 'updated')")
  return sql.literal('1 = 1')
}

export function resourceFilter(sql: SqlClient.SqlClient, view: SessionResourceCatalogView) {
  if (view === 'sources') return sql.literal('is_source = 1')
  if (view === 'outputs') return sql.literal('is_output = 1')
  if (view === 'change-requests') {
    return sql.literal("kind = 'change-request' AND is_output = 1")
  }
  return sql.literal('1 = 1')
}

function occurrenceRowsByResource(rows: readonly SessionResourceOccurrenceRow[]) {
  const byResource = new Map<string, SessionResourceOccurrenceRow[]>()
  for (const row of rows) {
    const existing = byResource.get(row.resource_id)
    if (existing) existing.push(row)
    else byResource.set(row.resource_id, [row])
  }
  return byResource
}

export function hydrateResources(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  rows: readonly SessionResourceRow[],
  view: SessionResourceCatalogView,
  identity: SessionResourceCatalogIdentity,
) {
  if (rows.length === 0) return Effect.succeed([])
  const branch = identity.branch ?? '__openwaggle:no-active-branch__'
  return Effect.map(
    sql<SessionResourceOccurrenceRow>`
      WITH RECURSIVE active_path(node_id) AS (
        ${activeCatalogPath(sql, sessionId, identity)}
      ), ranked_occurrences AS (
        SELECT id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at,
          ROW_NUMBER() OVER (
            PARTITION BY resource_id
            ORDER BY CASE
              WHEN node_id IN (SELECT node_id FROM active_path) THEN 0
              WHEN branch_id = ${branch}
                AND (node_id IS NULL OR NOT EXISTS (SELECT 1 FROM active_path)) THEN 0
              ELSE 1
            END ASC, created_at DESC, id DESC
          ) AS occurrence_rank
        FROM session_resource_occurrences
        WHERE resource_id IN ${sql.in(rows.map(({ id }) => id))}
          AND ${activityFilter(sql, view)}
      )
      SELECT id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at
      FROM ranked_occurrences
      WHERE occurrence_rank <= ${SESSION_RESOURCE_OCCURRENCE_PREVIEW_LIMIT}
      ORDER BY resource_id ASC, created_at ASC, id ASC
    `,
    (occurrences) => {
      const byResource = occurrenceRowsByResource(occurrences)
      return rows.map((row) => rowToResource(row, byResource.get(row.id) ?? []))
    },
  )
}
