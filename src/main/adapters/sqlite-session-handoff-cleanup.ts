import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { SessionControlRepositoryError } from '../errors'
import type { SessionOrganizationRepositoryShape } from '../ports/session-organization-repository'

export function completeHandoffCleanup(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionOrganizationRepositoryShape['completeHandoffCleanup']>[0],
) {
  return sql`
    UPDATE session_operations
    SET cleanup_json = ${null}, updated_at = ${Date.now()}
    WHERE caller_id = ${input.callerId} AND operation = ${'handoff'}
      AND target_scope = ${input.request.command.sessionId}
      AND idempotency_key = ${input.request.idempotencyKey}
      AND status = ${'completed'}
  `.pipe(
    Effect.asVoid,
    Effect.mapError(
      (cause) =>
        new SessionControlRepositoryError({ operation: 'complete-handoff-cleanup', cause }),
    ),
  )
}
