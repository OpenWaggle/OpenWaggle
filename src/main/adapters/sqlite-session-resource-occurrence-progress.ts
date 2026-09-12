import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import type { SessionResourceOccurrenceSelector } from '../ports/session-resource-repository'
import {
  rowToResource,
  type SessionResourceOccurrenceRow,
  type SessionResourceRow,
} from './sqlite-session-resource-codec'

const OCCURRENCE_PROGRESS_CHUNK_SIZE = 200

/** Each selector contributes at most one occurrence. Prefixes identify image slots, not catalogs. */
export function findResourcesByOccurrences(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  selectors: readonly SessionResourceOccurrenceSelector[],
) {
  return Effect.gen(function* () {
    const resources = new Map<string, SessionResource>()
    for (let offset = 0; offset < selectors.length; offset += OCCURRENCE_PROGRESS_CHUNK_SIZE) {
      const chunk = selectors.slice(offset, offset + OCCURRENCE_PROGRESS_CHUNK_SIZE)
      const occurrences = yield* sql<SessionResourceOccurrenceRow>`
        WITH matched_ids AS (
          SELECT (
            SELECT occurrence.id
            FROM session_resource_occurrences occurrence
            INNER JOIN session_resources resource ON resource.id = occurrence.resource_id
            WHERE resource.session_id = ${sessionId}
              AND occurrence.id >= json_extract(selector.value, '$.value')
              AND occurrence.id < json_extract(selector.value, '$.value') || char(65535)
              AND (
                json_extract(selector.value, '$.prefix') = 1
                OR occurrence.id = json_extract(selector.value, '$.value')
              )
            ORDER BY occurrence.id DESC
            LIMIT 1
          ) AS id
          FROM json_each(${JSON.stringify(chunk)}) selector
        )
        SELECT id, resource_id, node_id, branch_id, actor, activity, label, locator, created_at
        FROM session_resource_occurrences
        WHERE id IN (SELECT id FROM matched_ids)
      `
      if (occurrences.length === 0) continue
      const rows = yield* sql<SessionResourceRow>`
        SELECT id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
          available, is_source, is_output, created_at, updated_at
        FROM session_resources
        WHERE session_id = ${sessionId}
          AND id IN ${sql.in([...new Set(occurrences.map(({ resource_id }) => resource_id))])}
      `
      for (const row of rows) {
        const prior = resources.get(row.id)
        const matching = occurrences.filter(({ resource_id }) => resource_id === row.id)
        const resource = rowToResource(row, matching)
        resources.set(row.id, {
          ...resource,
          occurrences: [...(prior?.occurrences ?? []), ...resource.occurrences],
        })
      }
    }
    return [...resources.values()]
  })
}
