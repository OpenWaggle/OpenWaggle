import * as SqlClient from '@effect/sql/SqlClient'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { delegationSpecificationSchema } from '@shared/schemas/session-lifecycle'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlRepositoryError } from '../errors'
import {
  SessionOrchestrationUpdateRepository,
  type SessionOrchestrationUpdateRepositoryShape,
} from '../ports/session-orchestration-update-repository'

interface PendingUpdateRow {
  readonly id: string
  readonly delegation_id: string
  readonly worker_session_id: string
  readonly source_run_id: string
  readonly state: string
  readonly summary: string
  readonly created_at: number
}

interface PendingSpecificationRow {
  readonly id: string
  readonly delegation_id: string
  readonly parent_session_id: string
  readonly worker_session_id: string
  readonly specification_revision: number
  readonly specification_json: string
  readonly reason: string
  readonly created_at: number
}

function repositoryError(operation: string, cause: unknown) {
  return new SessionControlRepositoryError({ operation, cause })
}

function decodeUpdateState(value: string): 'ready_for_review' | 'needs_attention' {
  if (value === 'ready_for_review' || value === 'needs_attention') return value
  throw new Error(`Invalid orchestration update state: ${value}.`)
}

function listPending(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionOrchestrationUpdateRepositoryShape['listPending']>[0],
) {
  return sql<PendingUpdateRow>`
    SELECT id, delegation_id, worker_session_id, source_run_id, state, summary, created_at
    FROM session_orchestration_updates
    WHERE parent_session_id = ${input.parentSessionId} AND status = ${'pending'}
    ORDER BY created_at, id
  `.pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        updateId: row.id,
        delegationId: row.delegation_id,
        workerSessionId: row.worker_session_id,
        sourceRunId: row.source_run_id,
        state: decodeUpdateState(row.state),
        summary: row.summary,
        createdAt: row.created_at,
      })),
    ),
    Effect.mapError((cause) => repositoryError('list-pending-orchestration-updates', cause)),
  )
}

function markDelivered(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionOrchestrationUpdateRepositoryShape['markDelivered']>[0],
) {
  if (input.updateIds.length !== input.itemIds.length) {
    return Effect.fail(repositoryError('orchestration-update-identity-count-mismatch', input))
  }
  return sql
    .withTransaction(
      Effect.forEach(
        input.updateIds,
        (updateId, index) => sql`
          UPDATE session_orchestration_updates
          SET status = ${'delivered'}, delivered_run_id = ${input.runId},
            delivered_item_id = ${input.itemIds[index]}, delivered_at = ${input.deliveredAt}
          WHERE id = ${updateId} AND parent_session_id = ${input.parentSessionId}
            AND status = ${'pending'}
        `,
        { discard: true },
      ),
    )
    .pipe(
      Effect.asVoid,
      Effect.mapError((cause) => repositoryError('mark-orchestration-updates-delivered', cause)),
    )
}

function listPendingSpecifications(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionOrchestrationUpdateRepositoryShape['listPendingSpecifications']>[0],
) {
  return sql<PendingSpecificationRow>`
    SELECT id, delegation_id, parent_session_id, worker_session_id,
      specification_revision, specification_json, reason, created_at
    FROM delegation_specification_updates
    WHERE worker_session_id = ${input.workerSessionId} AND status = ${'pending'}
    ORDER BY created_at, id
  `.pipe(
    Effect.map((rows) =>
      rows.map((row) => ({
        updateId: row.id,
        delegationId: row.delegation_id,
        parentSessionId: row.parent_session_id,
        workerSessionId: row.worker_session_id,
        specificationRevision: row.specification_revision,
        specification: decodeUnknownExactOrThrow(
          delegationSpecificationSchema,
          JSON.parse(row.specification_json),
        ),
        reason: row.reason,
        createdAt: row.created_at,
      })),
    ),
    Effect.mapError((cause) => repositoryError('list-pending-specification-updates', cause)),
  )
}

function markSpecificationsDelivered(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionOrchestrationUpdateRepositoryShape['markSpecificationsDelivered']>[0],
) {
  if (input.updateIds.length !== input.itemIds.length) {
    return Effect.fail(repositoryError('specification-update-identity-count-mismatch', input))
  }
  return sql
    .withTransaction(
      Effect.forEach(
        input.updateIds,
        (updateId, index) => sql`
          UPDATE delegation_specification_updates
          SET status = ${'delivered'}, delivered_run_id = ${input.runId},
            delivered_item_id = ${input.itemIds[index]}, delivered_at = ${input.deliveredAt}
          WHERE id = ${updateId} AND worker_session_id = ${input.workerSessionId}
            AND status = ${'pending'}
        `,
        { discard: true },
      ),
    )
    .pipe(
      Effect.asVoid,
      Effect.mapError((cause) => repositoryError('mark-specification-updates-delivered', cause)),
    )
}

export const SqliteSessionOrchestrationUpdateRepositoryLive = Layer.effect(
  SessionOrchestrationUpdateRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionOrchestrationUpdateRepository.of({
      listPending: (input) => listPending(sql, input),
      markDelivered: (input) => markDelivered(sql, input),
      listPendingSpecifications: (input) => listPendingSpecifications(sql, input),
      markSpecificationsDelivered: (input) => markSpecificationsDelivered(sql, input),
    })
  }),
)
