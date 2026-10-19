import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import {
  SessionControlOperationJournal,
  type SessionControlOperationJournalShape,
} from '../ports/session-control-operation-journal'
import { decodeStoredSessionControlMutationOutcome } from './sqlite-session-control-outcome-decoder'
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

function decodeCompletedOutcome(outcomeJson: string | null) {
  return Effect.try({
    try: () => {
      if (outcomeJson === null) throw new Error('Completed operation has no outcome.')
      return decodeStoredSessionControlMutationOutcome(outcomeJson)
    },
    catch: (cause) => repositoryError('decode-completed-outcome', cause),
  })
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

/**
 * A replacement interrupts the Run and waits for it to settle while it holds the Session's
 * command serialization and attachment transition. A pending promotion steps aside from both while
 * Pi incorporates its steer and must take them back to complete; settlement waits for it only
 * briefly (`promotion-pending`), so a replacement admitted meanwhile failed the Run's settlement
 * and then left an already-steered Follow-up queued for a second delivery. Refuse it instead.
 */
function pendingPromotionReplaceRejection(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlOperationJournalShape['claim']>[0],
) {
  const command = input.request.command
  if (command.operation !== 'replace') return Effect.succeed(undefined)
  return reservedFollowUpIds(sql, command.sessionId).pipe(
    Effect.map((ids) =>
      ids.size === 0
        ? undefined
        : ({
            operation: 'replace',
            effect: 'rejected',
            sessionId: command.sessionId,
            code: 'follow_up_reserved',
          } as const),
    ),
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
              return decodeStoredSessionControlMutationOutcome(existing.outcome_json)
            },
            catch: (cause) => repositoryError('decode-idempotent-outcome', cause),
          })
          return { status: 'completed', replayed: true, outcome } as const
        }

        if (yield* pendingPromotionReservation(sql, input)) {
          return { status: 'pending', replayed: true } as const
        }

        const replaceRejection = yield* pendingPromotionReplaceRejection(sql, input)
        const state = yield* loadSessionControlState(sql, targetScope)
        const decision = replaceRejection
          ? ({ accepted: false, outcome: replaceRejection } as const)
          : input.decide(state)
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
          // An outcome derived from the final state cannot be rebuilt; the stored one stands.
          if (!input.outcomeForFinalState && existing.outcome_json !== outcomeJson) {
            return yield* Effect.fail(repositoryError('operation-outcome-conflict', { operation }))
          }
          return yield* decodeCompletedOutcome(existing.outcome_json)
        }
        const now = Date.now()
        let recordedOutcome = input.outcome
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
          if (input.outcomeForFinalState) {
            recordedOutcome = input.outcomeForFinalState(finalizedState)
          }
        }
        yield* sql`
          UPDATE session_operations
          SET status = ${'completed'}, outcome_json = ${JSON.stringify(recordedOutcome)},
            updated_at = ${now}
          WHERE caller_id = ${input.callerId}
            AND operation = ${operation}
            AND target_scope = ${targetScope}
            AND idempotency_key = ${input.request.idempotencyKey}
            AND status = ${'pending'}
        `
        return recordedOutcome
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
