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
        is_source,
        is_output,
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
        occurrence.locator,
        occurrence.display_name,
        occurrence.display_order,
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
