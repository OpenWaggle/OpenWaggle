import type * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import { parseJsonUnknown } from '@shared/schema'
import { decodeSessionControlMutationOutcome } from '@shared/schemas/session-control'
import type { SessionControlMutationResponse } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlRepositoryError } from '../errors'
import type { SessionOrganizationRepositoryShape } from '../ports/session-organization-repository'

interface OperationRow {
  readonly request_json: string
  readonly status: 'pending' | 'completed'
  readonly outcome_json: string | null
}

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

/** Read-only replay classification under the Host's existing per-Session command serialization. */
export function prepareSessionArchive(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionOrganizationRepositoryShape['prepareArchive']>[0],
  rejectMissing: () => Effect.Effect<SessionControlMutationResponse, SessionControlRepositoryError>,
) {
  const command = input.request.command
  return Effect.gen(function* () {
    const existingRows = yield* sql<OperationRow>`
      SELECT request_json, status, outcome_json FROM session_operations
      WHERE caller_id = ${input.callerId} AND operation = ${command.operation}
        AND target_scope = ${command.sessionId}
        AND idempotency_key = ${input.request.idempotencyKey}
      LIMIT 1
    `
    const existing = existingRows[0]
    if (existing) {
      if (existing.request_json !== canonicalJson(command) || !existing.outcome_json) {
        return yield* Effect.fail(repositoryError('organization-idempotency-key-reused', command))
      }
      return {
        status: 'completed',
        response: {
          contractVersion: input.request.contractVersion,
          requestId: input.request.requestId,
          idempotencyKey: input.request.idempotencyKey,
          replayed: true,
          outcome: decodeSessionControlMutationOutcome(parseJsonUnknown(existing.outcome_json)),
        },
      } as const
    }
    const sessions = yield* sql<{
      readonly id: string
    }>`SELECT id FROM sessions WHERE id = ${command.sessionId} LIMIT 1`
    if (sessions.length === 0) {
      return { status: 'completed', response: yield* rejectMissing() } as const
    }
    return { status: 'ready' } as const
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof SessionControlRepositoryError
        ? cause
        : repositoryError('prepare-session-archive', cause),
    ),
  )
}
