import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import { parseJsonUnknown } from '@shared/schema'
import { decodeSessionControlMutationOutcome } from '@shared/schemas/session-control'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import {
  SessionControlRepository,
  type SessionControlRepositoryShape,
} from '../ports/session-control-repository'
import { applyCurrentFollowUpAuthorization } from './session-follow-up-authorization'
import { loadSessionControlState, persistSessionControlState } from './sqlite-session-control-state'
import { reservedFollowUpIds } from './sqlite-session-follow-up-reservation'
import { liveSessionAuthorityBlockReason } from './sqlite-session-live-authority'
import { directWorkerRunAdmission } from './sqlite-session-parent-run-admission'

interface SessionOperationRow {
  readonly request_json: string
  readonly status: 'pending' | 'completed'
  readonly outcome_json: string | null
}

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function isQueueMutation(operation: string) {
  return (
    operation === 'queue-withdraw' ||
    operation === 'queue-reorder' ||
    operation === 'queue-pause' ||
    operation === 'queue-resume' ||
    operation === 'queue-update-authorization'
  )
}

function reservedQueueMutationRejection(
  sql: SqlClient.SqlClient,
  operation: string,
  sessionId: string,
) {
  if (!isQueueMutation(operation)) return Effect.succeed(undefined)
  return reservedFollowUpIds(sql, sessionId).pipe(
    Effect.map((reservedIds) =>
      reservedIds.size === 0
        ? undefined
        : ({
            accepted: false,
            outcome: {
              operation,
              effect: 'rejected',
              sessionId,
              code: 'follow_up_reserved',
            },
          } as const),
    ),
  )
}

function executeMutation(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlRepositoryShape['executeMutation']>[0],
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
          const outcome = yield* Effect.try({
            try: () => {
              if (existing.status !== 'completed' || existing.outcome_json === null) {
                throw new Error('A synchronous mutation cannot replay a pending operation.')
              }
              return decodeSessionControlMutationOutcome(parseJsonUnknown(existing.outcome_json))
            },
            catch: (cause) => repositoryError('decode-idempotent-outcome', cause),
          })
          return { replayed: true, outcome }
        }

        const loadedState = yield* loadSessionControlState(sql, targetScope)
        const state =
          operation === 'queue-resume'
            ? yield* applyCurrentFollowUpAuthorization(sql, loadedState)
            : loadedState
        const authorityBlock = yield* liveSessionAuthorityBlockReason(sql, input.callerId)
        const reservationBlock = yield* reservedQueueMutationRejection(sql, operation, targetScope)
        const decision = reservationBlock
          ? reservationBlock
          : authorityBlock
            ? ({
                accepted: false,
                outcome: {
                  operation,
                  effect: 'rejected',
                  sessionId: targetScope,
                  code: authorityBlock,
                },
              } as const)
            : input.decide(state)
        const now = Date.now()
        const startsNewRun =
          decision.accepted && state.run.state === 'idle' && decision.state.run.state === 'starting'
        const hostRunCeiling = input.hostRunCeiling ?? DEFAULT_SETTINGS.sessionHostRunCeiling
        const admittedDecision = startsNewRun
          ? yield* Effect.gen(function* () {
              const parentAdmission = yield* directWorkerRunAdmission(sql, targetScope)
              if (!parentAdmission.admitted) {
                return {
                  accepted: false,
                  outcome: {
                    operation,
                    effect: 'rejected',
                    sessionId: targetScope,
                    code: 'parent_concurrency_limit_reached',
                  },
                } as const
              }
              const rows = yield* sql<{ readonly count: number }>`
                SELECT COUNT(*) AS count
                FROM session_control_states
                WHERE active_run_id IS NOT NULL
              `
              const hostActiveRuns = rows[0]?.count ?? 0
              return hostActiveRuns >= hostRunCeiling
                ? ({
                    accepted: false,
                    outcome: {
                      operation,
                      effect: 'rejected',
                      sessionId: targetScope,
                      code: 'host_run_ceiling_reached',
                    },
                  } as const)
                : decision
            })
          : decision
        if (admittedDecision.accepted) {
          yield* persistSessionControlState(sql, admittedDecision.state, now)
        }
        yield* sql`
        INSERT INTO session_operations (
          caller_id,
          operation,
          target_scope,
          idempotency_key,
          request_json,
          status,
          outcome_json,
          created_at,
          updated_at
        )
        VALUES (
          ${input.callerId},
          ${operation},
          ${targetScope},
          ${input.request.idempotencyKey},
          ${requestJson},
          ${'completed'},
          ${JSON.stringify(admittedDecision.outcome)},
          ${now},
          ${now}
        )
      `
        return { replayed: false, outcome: admittedDecision.outcome }
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('execute-mutation', cause),
      ),
    )
}

export const SqliteSessionControlRepositoryLive = Layer.effect(
  SessionControlRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionControlRepository.of({
      executeMutation: (input) => executeMutation(sql, input),
    })
  }),
)
