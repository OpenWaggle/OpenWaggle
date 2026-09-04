import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionResourceRepositoryError } from '../errors'
import {
  rowToResource,
  type SessionResourceOccurrenceRow,
  type SessionResourceRow,
} from './sqlite-session-resource-codec'

function repositoryError(operation: string, cause: unknown) {
  return new SessionResourceRepositoryError({ operation, cause })
}

export function readResourceById(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  resourceId: string,
) {
  return Effect.gen(function* () {
    const rows = yield* sql<SessionResourceRow>`
      SELECT
        id,
        session_id,
        canonical_key,
        kind,
        title,
        mime_type,
        locator,
        managed_path,
        available,
        created_at,
        updated_at
      FROM session_resources
      WHERE session_id = ${sessionId}
        AND id = ${resourceId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return null
    const occurrenceRows = yield* sql<SessionResourceOccurrenceRow>`
      SELECT id, resource_id, node_id, branch_id, actor, activity, label, created_at
      FROM session_resource_occurrences
      WHERE resource_id = ${resourceId}
      ORDER BY created_at ASC, id ASC
    `
    return rowToResource(row, occurrenceRows)
  })
}

export function listResources(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return Effect.gen(function* () {
    const resourceRows = yield* sql<SessionResourceRow>`
      SELECT
        id,
        session_id,
        canonical_key,
        kind,
        title,
        mime_type,
        locator,
        managed_path,
        available,
        created_at,
        updated_at
      FROM session_resources
      WHERE session_id = ${sessionId}
      ORDER BY updated_at DESC, id ASC
    `

    const occurrenceRows = yield* sql<SessionResourceOccurrenceRow>`
      SELECT
        occurrence.id,
        occurrence.resource_id,
        occurrence.node_id,
        occurrence.branch_id,
        occurrence.actor,
        occurrence.activity,
        occurrence.label,
        occurrence.created_at
      FROM session_resource_occurrences occurrence
      INNER JOIN session_resources resource ON resource.id = occurrence.resource_id
      WHERE resource.session_id = ${sessionId}
      ORDER BY occurrence.created_at ASC, occurrence.id ASC
    `
    const occurrencesByResource = new Map<string, SessionResourceOccurrenceRow[]>()
    for (const occurrenceRow of occurrenceRows) {
      const rows = occurrencesByResource.get(occurrenceRow.resource_id) ?? []
      rows.push(occurrenceRow)
      occurrencesByResource.set(occurrenceRow.resource_id, rows)
    }
    return resourceRows.map((row) => rowToResource(row, occurrencesByResource.get(row.id) ?? []))
  }).pipe(Effect.mapError((cause) => repositoryError('list', cause)))
}
