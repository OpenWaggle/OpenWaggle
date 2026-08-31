import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import { parseJsonUnknown } from '@shared/schema'
import { decodeSessionControlMutationOutcome } from '@shared/schemas/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import {
  SessionControlOperationJournal,
  type SessionControlOperationJournalShape,
} from '../ports/session-control-operation-journal'
import { loadSessionControlState, persistSessionControlState } from './sqlite-session-control-state'
import { reservedFollowUpIds } from './sqlite-session-follow-up-reservation'

interface SessionOperationRow {
  readonly request_json: string
  readonly status: 'pending' | 'completed'
  readonly outcome_json: string | null
}

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function pendingPromotionReservation(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlOperationJournalShape['claim']>[0],
) {
  const command = input.request.command
  if (command.operation !== 'promote') return Effect.succeed(false)
  return reservedFollowUpIds(sql, command.sessionId).pipe(
    Effect.map((ids) => ids.has(command.followUpId)),
  )
}

function claimExternalOperation(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlOperationJournalShape['claim']>[0],
) {
  const operation = input.request.command.operation
  const targetScope = input.request.command.sessionId
  const requestJson = canonicalJson(input.request.command)

  return sql
    .withTransaction(
      Effect.gen(function* () {
        const existingRows = yield* sql<SessionOperationRow>`
          SELECT request_json, status, outcome_json
          FROM session_operations
          WHERE caller_id = ${input.callerId}
            AND operation = ${operation}
            AND target_scope = ${targetScope}
            AND idempotency_key = ${input.request.idempotencyKey}
          LIMIT 1
        `
        const existing = existingRows[0]
        if (existing) {
          if (existing.request_json !== requestJson) {
            return yield* Effect.fail(
              repositoryError('idempotency-key-reused', {
                operation,
                targetScope,
                idempotencyKey: input.request.idempotencyKey,
              }),
            )
          }
          if (existing.status === 'pending') {
            return { status: 'pending', replayed: true } as const
          }
          const outcome = yield* Effect.try({
            try: () => {
              if (existing.outcome_json === null) {
                throw new Error('Completed operation has no outcome.')
              }
              return decodeSessionControlMutationOutcome(parseJsonUnknown(existing.outcome_json))
            },
            catch: (cause) => repositoryError('decode-idempotent-outcome', cause),
          })
          return { status: 'completed', replayed: true, outcome } as const
        }

        if (yield* pendingPromotionReservation(sql, input)) {
          return { status: 'pending', replayed: true } as const
        }

        const state = yield* loadSessionControlState(sql, targetScope)
        const decision = input.decide(state)
        const now = Date.now()
        if (decision.accepted) {
          if (decision.state) yield* persistSessionControlState(sql, decision.state, now)
          yield* sql`
            INSERT INTO session_operations (
              caller_id, operation, target_scope, idempotency_key, request_json,
              status, outcome_json, created_at, updated_at
            )
            VALUES (
              ${input.callerId}, ${operation}, ${targetScope}, ${input.request.idempotencyKey},
              ${requestJson}, ${'pending'}, ${null}, ${now}, ${now}
            )
          `
          return {
            status: 'claimed',
            stateRevision: decision.state?.revision ?? state.revision,
          } as const
        }

        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          )
          VALUES (
            ${input.callerId}, ${operation}, ${targetScope}, ${input.request.idempotencyKey},
            ${requestJson}, ${'completed'}, ${JSON.stringify(decision.outcome)}, ${now}, ${now}
          )
        `
        return { status: 'completed', replayed: false, outcome: decision.outcome } as const
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('claim-external-operation', cause),
      ),
    )
}

function completeExternalOperation(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlOperationJournalShape['complete']>[0],
) {
  const operation = input.request.command.operation
  const targetScope = input.request.command.sessionId
  const requestJson = canonicalJson(input.request.command)
  const outcomeJson = JSON.stringify(input.outcome)

  return sql
    .withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<SessionOperationRow>`
          SELECT request_json, status, outcome_json
          FROM session_operations
          WHERE caller_id = ${input.callerId}
            AND operation = ${operation}
            AND target_scope = ${targetScope}
            AND idempotency_key = ${input.request.idempotencyKey}
          LIMIT 1
        `
        const existing = rows[0]
        if (!existing) {
          return yield* Effect.fail(repositoryError('operation-not-claimed', { operation }))
        }
        if (existing.request_json !== requestJson) {
          return yield* Effect.fail(repositoryError('idempotency-key-reused', { operation }))
        }
        if (existing.status === 'completed') {
          if (existing.outcome_json !== outcomeJson) {
            return yield* Effect.fail(repositoryError('operation-outcome-conflict', { operation }))
          }
          return
        }
        const now = Date.now()
        if (input.finalizeState) {
          const state = yield* loadSessionControlState(sql, targetScope)
          const finalizedState = input.finalizeState(state)
          if (state.run.state === 'stopping' && finalizedState.run.state === 'idle') {
            yield* sql`
              UPDATE session_runs
              SET status = ${'interrupted'}, updated_at = ${now}
              WHERE id = ${state.run.runId} AND session_id = ${state.sessionId}
            `
          }
          if (
            state.run.state === 'stopping' &&
            finalizedState.run.state === 'starting' &&
            state.run.runId !== finalizedState.run.runId
          ) {
            yield* sql`
              UPDATE session_runs
              SET status = ${'interrupted'}, updated_at = ${now}
              WHERE id = ${state.run.runId} AND session_id = ${state.sessionId}
            `
          }
          yield* persistSessionControlState(sql, finalizedState, now)
        }
        yield* sql`
          UPDATE session_operations
          SET status = ${'completed'}, outcome_json = ${outcomeJson}, updated_at = ${now}
          WHERE caller_id = ${input.callerId}
            AND operation = ${operation}
            AND target_scope = ${targetScope}
            AND idempotency_key = ${input.request.idempotencyKey}
            AND status = ${'pending'}
        `
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('complete-external-operation', cause),
      ),
    )
}

export const SqliteSessionControlOperationJournalLive = Layer.effect(
  SessionControlOperationJournal,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionControlOperationJournal.of({
      claim: (input) => claimExternalOperation(sql, input),
      complete: (input) => completeExternalOperation(sql, input),
    })
  }),
)
