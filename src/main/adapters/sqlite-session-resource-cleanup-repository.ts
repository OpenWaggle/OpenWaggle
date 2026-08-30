import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionResourceRepositoryError } from '../errors'
import {
  SessionResourceCleanupRepository,
  type SessionResourceCleanupRepositoryShape,
} from '../ports/session-resource-cleanup-repository'

function cleanupError(operation: string, cause: unknown) {
  return new SessionResourceRepositoryError({ operation, cause })
}

export const SqliteSessionResourceCleanupRepositoryLive = Layer.effect(
  SessionResourceCleanupRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionResourceCleanupRepository.of({
      listPending: (limit) =>
        sql<{ readonly session_id: string }>`
          SELECT session_id
          FROM session_resource_cleanup_queue
          ORDER BY queued_at ASC
          LIMIT ${limit}
        `.pipe(
          Effect.map((rows) => rows.map(({ session_id }) => SessionId(session_id))),
          Effect.mapError((cause) => cleanupError('listPendingResourceCleanup', cause)),
        ),
      complete: (sessionId) =>
        sql`
          DELETE FROM session_resource_cleanup_queue
          WHERE session_id = ${sessionId}
        `.pipe(
          Effect.asVoid,
          Effect.mapError((cause) => cleanupError('completeResourceCleanup', cause)),
        ),
    } satisfies SessionResourceCleanupRepositoryShape)
  }),
)
