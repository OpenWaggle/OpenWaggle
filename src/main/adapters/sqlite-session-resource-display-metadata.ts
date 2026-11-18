import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionResourceRepositoryError } from '../errors'
import type { SessionResourceDisplayMetadata } from '../ports/session-resource-repository'

const DISPLAY_METADATA_CHUNK_SIZE = 200

/** Enrich only missing fields, scoped to one session and a bounded projection page. */
export function enrichSessionResourceDisplayMetadata(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  metadata: readonly SessionResourceDisplayMetadata[],
) {
  return Effect.gen(function* () {
    for (let offset = 0; offset < metadata.length; offset += DISPLAY_METADATA_CHUNK_SIZE) {
      const chunk = metadata.slice(offset, offset + DISPLAY_METADATA_CHUNK_SIZE)
      yield* sql`
        UPDATE session_resource_occurrences
        SET display_name = COALESCE(
              session_resource_occurrences.display_name,
              json_extract(annotation.value, '$.displayName')
            ),
            display_order = COALESCE(
              session_resource_occurrences.display_order,
              json_extract(annotation.value, '$.displayOrder')
            )
        FROM json_each(${JSON.stringify(chunk)}) AS annotation,
             session_resources AS resource
        WHERE resource.id = session_resource_occurrences.resource_id
          AND resource.session_id = ${sessionId}
          AND (session_resource_occurrences.display_name IS NULL
            OR session_resource_occurrences.display_order IS NULL)
          AND (
            (json_extract(annotation.value, '$.prefix') = 0
              AND session_resource_occurrences.id = json_extract(annotation.value, '$.value'))
            OR (json_extract(annotation.value, '$.prefix') = 1
              AND session_resource_occurrences.id >= json_extract(annotation.value, '$.value')
              AND session_resource_occurrences.id < json_extract(annotation.value, '$.value') || char(65535))
          )
      `
    }
  }).pipe(
    Effect.asVoid,
    Effect.mapError(
      (cause) => new SessionResourceRepositoryError({ operation: 'enrichDisplayMetadata', cause }),
    ),
  )
}
