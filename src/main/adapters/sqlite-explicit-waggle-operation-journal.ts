import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import { parseJsonUnknown } from '@shared/schema'
import type { AgentSendReport } from '@shared/types/agent'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import {
  ExplicitWaggleOperationJournal,
  type ExplicitWaggleOperationJournalShape,
  type ExplicitWaggleRequest,
} from '../ports/explicit-waggle-operation-journal'

const OPERATION = 'waggle'

interface OperationRow {
  readonly request_json: string
  readonly status: 'pending' | 'completed'
  readonly outcome_json: string | null
}

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function commandJson(request: ExplicitWaggleRequest) {
  const { requestId: _requestId, idempotencyKey: _idempotencyKey, ...command } = request
  return canonicalJson(command)
}

function decodeReport(raw: string | null): AgentSendReport {
  const value = raw === null ? null : parseJsonUnknown(raw)
  if (
    !isRecord(value) ||
    (value.outcome !== 'delivered' &&
      value.outcome !== 'refused' &&
      value.outcome !== 'cancelled') ||
    (value.message !== undefined && typeof value.message !== 'string') ||
    (value.code !== undefined && typeof value.code !== 'string')
  ) {
    throw new Error('Completed explicit Waggle operation has an invalid report.')
  }
  return {
    outcome: value.outcome,
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
  }
}

function claim(
  sql: SqlClient.SqlClient,
  input: Parameters<ExplicitWaggleOperationJournalShape['claim']>[0],
) {
  const requestJson = commandJson(input.request)
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<OperationRow>`
          SELECT request_json, status, outcome_json FROM session_operations
          WHERE caller_id = ${input.callerId}
            AND operation = ${OPERATION}
            AND target_scope = ${input.request.sessionId}
            AND idempotency_key = ${input.request.idempotencyKey}
          LIMIT 1
        `
        const existing = rows[0]
        if (existing) {
          if (existing.request_json !== requestJson) {
            return yield* Effect.fail(
              repositoryError('waggle-idempotency-key-reused', {
                sessionId: input.request.sessionId,
                idempotencyKey: input.request.idempotencyKey,
              }),
            )
          }
          if (existing.status === 'pending') {
            return { status: 'pending', replayed: true } as const
          }
          return {
            status: 'completed',
            replayed: true,
            report: decodeReport(existing.outcome_json),
          } as const
        }

        const now = Date.now()
        yield* sql`
          INSERT INTO session_operations (
            caller_id, operation, target_scope, idempotency_key, request_json,
            status, outcome_json, created_at, updated_at
          ) VALUES (
            ${input.callerId}, ${OPERATION}, ${input.request.sessionId},
            ${input.request.idempotencyKey}, ${requestJson}, ${'pending'}, ${null}, ${now}, ${now}
          )
        `
        return { status: 'claimed' } as const
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('claim-explicit-waggle-operation', cause),
      ),
    )
}

function complete(
  sql: SqlClient.SqlClient,
  input: Parameters<ExplicitWaggleOperationJournalShape['complete']>[0],
) {
  const requestJson = commandJson(input.request)
  const outcomeJson = canonicalJson(input.report)
  return sql
    .withTransaction(
      Effect.gen(function* () {
        const rows = yield* sql<OperationRow>`
          SELECT request_json, status, outcome_json FROM session_operations
          WHERE caller_id = ${input.callerId}
            AND operation = ${OPERATION}
            AND target_scope = ${input.request.sessionId}
            AND idempotency_key = ${input.request.idempotencyKey}
          LIMIT 1
        `
        const existing = rows[0]
        if (!existing) {
          return yield* Effect.fail(repositoryError('waggle-operation-not-claimed', input))
        }
        if (existing.request_json !== requestJson) {
          return yield* Effect.fail(repositoryError('waggle-idempotency-key-reused', input))
        }
        if (existing.status === 'completed') {
          if (existing.outcome_json !== outcomeJson) {
            return yield* Effect.fail(repositoryError('waggle-operation-outcome-conflict', input))
          }
          return
        }
        yield* sql`
          UPDATE session_operations
          SET status = ${'completed'}, outcome_json = ${outcomeJson}, updated_at = ${Date.now()}
          WHERE caller_id = ${input.callerId}
            AND operation = ${OPERATION}
            AND target_scope = ${input.request.sessionId}
            AND idempotency_key = ${input.request.idempotencyKey}
            AND status = ${'pending'}
        `
      }),
    )
    .pipe(
      Effect.mapError((cause) =>
        cause instanceof SessionControlRepositoryError
          ? cause
          : repositoryError('complete-explicit-waggle-operation', cause),
      ),
    )
}

export const SqliteExplicitWaggleOperationJournalLive = Layer.effect(
  ExplicitWaggleOperationJournal,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return ExplicitWaggleOperationJournal.of({
      claim: (input) => claim(sql, input),
      complete: (input) => complete(sql, input),
    })
  }),
)
