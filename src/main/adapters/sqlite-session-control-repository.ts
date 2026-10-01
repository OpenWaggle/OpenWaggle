import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import type { SessionControlMutationRequest } from '@shared/types/session-control'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import { SessionControlRepositoryError } from '../errors'
import {
  type SessionControlMutationDecision,
  SessionControlRepository,
  type SessionControlRepositoryShape,
  type SessionControlRunAdmissionRefusal,
} from '../ports/session-control-repository'
import { applyCurrentFollowUpAuthorization } from './session-follow-up-authorization'
import { decodeStoredSessionControlMutationOutcome } from './sqlite-session-control-outcome-decoder'
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
    operation === 'queue-update-authorization' ||
    operation === 'queue-edit-begin'
  )
}

/** Operations that can deliver the queue head, so they see its current authorization first. */
function mayDeliverQueueHead(operation: string) {
  return (
    operation === 'queue-resume' ||
    operation === 'queue-edit-save' ||
    operation === 'queue-edit-cancel'
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

function replayExistingOperation(input: {
  readonly existing: SessionOperationRow
  readonly requestJson: string
  readonly operation: string
  readonly targetScope: string
  readonly idempotencyKey: string
}) {
  if (input.existing.request_json !== input.requestJson) {
    return Effect.fail(
      repositoryError('idempotency-key-reused', {
        operation: input.operation,
        targetScope: input.targetScope,
        idempotencyKey: input.idempotencyKey,
      }),
    )
  }
  return Effect.try({
    try: () => {
      if (input.existing.status !== 'completed' || input.existing.outcome_json === null) {
        throw new Error('A synchronous mutation cannot replay a pending operation.')
      }
      return {
        replayed: true,
        outcome: decodeStoredSessionControlMutationOutcome(input.existing.outcome_json),
      } as const
    },
    catch: (cause) => repositoryError('decode-idempotent-outcome', cause),
  })
}

function loadExistingOperation(
  sql: SqlClient.SqlClient,
  input: {
    readonly callerId: string
    readonly operation: string
    readonly targetScope: string
    readonly idempotencyKey: string
  },
) {
  return sql<SessionOperationRow>`
    SELECT request_json, status, outcome_json
    FROM session_operations
    WHERE caller_id = ${input.callerId}
      AND operation = ${input.operation}
      AND target_scope = ${input.targetScope}
      AND idempotency_key = ${input.idempotencyKey}
    LIMIT 1
  `
}

function newRunAdmissionRefusal(
  sql: SqlClient.SqlClient,
  targetScope: string,
  hostRunCeiling: number,
) {
  return Effect.gen(function* () {
    const parentAdmission = yield* directWorkerRunAdmission(sql, targetScope)
    if (!parentAdmission.admitted) return 'parent_concurrency_limit_reached' as const
    const rows = yield* sql<{ readonly count: number }>`
      SELECT COUNT(*) AS count
      FROM session_control_states
      WHERE active_run_id IS NOT NULL
    `
    const hostActiveRuns = rows[0]?.count ?? 0
    return hostActiveRuns >= hostRunCeiling ? ('host_run_ceiling_reached' as const) : undefined
  })
}

function decisionWithoutNewRun(input: {
  readonly input: Parameters<SessionControlRepositoryShape['executeMutation']>[0]
  readonly state: SessionControlSessionState
  readonly operation: SessionControlMutationRequest['command']['operation']
  readonly targetScope: string
  readonly refusal: SessionControlRunAdmissionRefusal
}): SessionControlMutationDecision {
  const rejected = {
    accepted: false,
    outcome: {
      operation: input.operation,
      effect: 'rejected',
      sessionId: input.targetScope,
      code: input.refusal,
    },
  } as const
  const fallback = input.input.decideWithoutNewRun?.(input.state, input.refusal)
  return fallback?.accepted && fallback.state.run.state !== 'starting' ? fallback : rejected
}

function executeMutation(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlRepositoryShape['executeMutation']>[0],
) {
  const { operation, sessionId: targetScope } = input.request.command
  const requestJson = canonicalJson(input.request.command)

  return sql
    .withTransaction(
      Effect.gen(function* () {
        const existingRows = yield* loadExistingOperation(sql, {
          callerId: input.callerId,
          operation,
          targetScope,
          idempotencyKey: input.request.idempotencyKey,
        })
        const existing = existingRows[0]
        if (existing) {
          return yield* replayExistingOperation({
            existing,
            requestJson,
            operation,
            targetScope,
            idempotencyKey: input.request.idempotencyKey,
          })
        }

        const loadedState = yield* loadSessionControlState(sql, targetScope)
        const state = mayDeliverQueueHead(operation)
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
        const refusal = startsNewRun
          ? yield* newRunAdmissionRefusal(sql, targetScope, hostRunCeiling)
          : undefined
        const admittedDecision = refusal
          ? decisionWithoutNewRun({ input, state, operation, targetScope, refusal })
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
