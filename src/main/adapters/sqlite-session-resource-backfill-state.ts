import type * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionResourceRepositoryError } from '../errors'

function backfillStateError(operation: string, cause: unknown) {
  return new SessionResourceRepositoryError({ operation, cause })
}

export function getSessionResourceBackfillCursor(sql: SqlClient.SqlClient, sessionId: SessionId) {
  return sql<{ readonly through_created_order: number }>`
    SELECT through_created_order
    FROM session_resource_backfill_state
    WHERE session_id = ${sessionId}
    LIMIT 1
  `.pipe(
    Effect.map((rows) => rows[0]?.through_created_order ?? -1),
    Effect.mapError((cause) => backfillStateError('getBackfillCursor', cause)),
  )
}

export function advanceSessionResourceBackfillCursor(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  throughCreatedOrder: number,
) {
  return sql`
    INSERT INTO session_resource_backfill_state (session_id, through_created_order)
    VALUES (${sessionId}, ${throughCreatedOrder})
    ON CONFLICT(session_id) DO UPDATE SET
      through_created_order = MAX(
        session_resource_backfill_state.through_created_order,
        excluded.through_created_order
      )
  `.pipe(
    Effect.asVoid,
    Effect.mapError((cause) => backfillStateError('advanceBackfillCursor', cause)),
  )
}
