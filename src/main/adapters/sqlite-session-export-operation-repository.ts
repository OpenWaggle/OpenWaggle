import { randomUUID } from 'node:crypto'
import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import type { SessionExportManifest } from '@shared/types/session-export'
import type { SessionExportProgress } from '@shared/types/session-export-operation'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionExportOperationRepositoryError } from '../errors'
import {
  SessionExportOperationRepository,
  type SessionExportOperationRepositoryShape,
} from '../ports/session-export-operation-repository'
import {
  beginExportArtifactInstallation,
  clearExportArtifactPreparation,
  persistExportArtifactPreparation,
} from './sqlite-session-export-artifact-preparation'
import {
  type SessionExportOperationRow,
  sessionExportOperationRecord,
} from './sqlite-session-export-operation-row'
import { recoverExportOperationsAfterHostLoss } from './sqlite-session-export-recovery'

function repositoryError(operation: string, cause: unknown) {
  return new SessionExportOperationRepositoryError({ operation, cause })
}

function withRepositoryError<A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, SessionExportOperationRepositoryError, R> {
  return effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof SessionExportOperationRepositoryError
        ? cause
        : repositoryError(operation, cause),
    ),
  )
}

function temporaryPath(destinationPath: string, operationId: string) {
  return `${destinationPath}.openwaggle-${operationId}.tmp`
}

function readById(sql: SqlClient.SqlClient, sessionId: string, operationId: string) {
  return sql<SessionExportOperationRow>`
    SELECT * FROM session_export_operations
    WHERE id = ${operationId} AND session_id = ${sessionId}
    LIMIT 1
  `.pipe(Effect.map((rows) => (rows[0] ? sessionExportOperationRecord(rows[0]) : null)))
}

function readByOperationId(sql: SqlClient.SqlClient, operationId: string) {
  return sql<SessionExportOperationRow>`
    SELECT * FROM session_export_operations WHERE id = ${operationId} LIMIT 1
  `.pipe(Effect.map((rows) => (rows[0] ? sessionExportOperationRecord(rows[0]) : null)))
}

function createOperation(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionExportOperationRepositoryShape['create']>[0],
) {
  const requestJson = canonicalJson(input.command)
  return sql.withTransaction(
    Effect.gen(function* () {
      const existingRows = yield* sql<
        SessionExportOperationRow & { readonly request_json: string }
      >`
        SELECT * FROM session_export_operations
        WHERE caller_id = ${input.callerId}
          AND session_id = ${input.command.sessionId}
          AND idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `
      const existing = existingRows[0]
      if (existing) {
        if (existing.request_json !== requestJson) {
          return yield* Effect.fail(repositoryError('idempotency-key-reused', input))
        }
        return { operation: sessionExportOperationRecord(existing), replayed: true }
      }

      const operationId = randomUUID()
      const branchScope = input.command.branchScope ?? 'active-branch'
      yield* sql`
        INSERT INTO session_export_operations (
          id, caller_id, session_id, idempotency_key, request_json, format,
          destination_path, destination_root, resource_source_root, temporary_path, overwrite_existing,
          branch_scope, branch_id,
          include_queue_bodies, resources_json, status, created_at, updated_at
        ) VALUES (
          ${operationId}, ${input.callerId}, ${input.command.sessionId}, ${input.idempotencyKey},
          ${requestJson}, ${input.command.format}, ${input.command.destinationPath},
          ${input.command.destinationRoot ?? null},
          ${input.resourceSourceRoot ?? null},
          ${temporaryPath(input.command.destinationPath, operationId)},
          ${input.command.overwriteExisting ? 1 : 0}, ${branchScope},
          ${input.command.branchId ?? null}, ${input.command.includeQueueBodies ? 1 : 0},
          ${canonicalJson(input.command.resources ?? [])}, ${'queued'}, ${input.now}, ${input.now}
        )
      `
      const created = yield* readByOperationId(sql, operationId)
      if (!created) return yield* Effect.fail(repositoryError('read-created-operation', input))
      return { operation: created, replayed: false }
    }),
  )
}

function requestCancellation(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionExportOperationRepositoryShape['requestCancellation']>[0],
) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const existing = yield* readById(sql, input.sessionId, input.exportOperationId)
      if (!existing) return yield* Effect.fail(repositoryError('export-not-found', input))
      const replayed = existing.cancelRequested || existing.status === 'cancelled'
      if (existing.status === 'queued') {
        yield* sql`
          UPDATE session_export_operations
          SET status = ${'cancelled'}, cancel_requested = ${1}, updated_at = ${input.now},
            completed_at = ${input.now}
          WHERE id = ${input.exportOperationId}
        `
      }
      if (existing.status === 'running') {
        yield* sql`
          UPDATE session_export_operations
          SET status = ${'cancelling'}, cancel_requested = ${1}, updated_at = ${input.now}
          WHERE id = ${input.exportOperationId}
        `
      }
      const updated = yield* readById(sql, input.sessionId, input.exportOperationId)
      if (!updated) return yield* Effect.fail(repositoryError('read-cancelled-operation', input))
      return { operation: updated, replayed }
    }),
  )
}

function claimExecution(sql: SqlClient.SqlClient, operationId: string, now: number) {
  const executionToken = randomUUID()
  return sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        UPDATE session_export_operations
        SET status = ${'running'}, execution_token = ${executionToken}, updated_at = ${now}
        WHERE id = ${operationId} AND status = ${'queued'} AND cancel_requested = ${0}
      `
      const rows = yield* sql<SessionExportOperationRow>`
        SELECT * FROM session_export_operations WHERE id = ${operationId} LIMIT 1
      `
      const row = rows[0]
      const operation = row ? sessionExportOperationRecord(row) : null
      return row?.execution_token === executionToken && operation
        ? ({ status: 'claimed', operation } as const)
        : ({ status: 'not-claimable', ...(operation ? { operation } : {}) } as const)
    }),
  )
}

function persistSnapshot(
  sql: SqlClient.SqlClient,
  operationId: string,
  manifest: SessionExportManifest,
  now: number,
) {
  const manifestJson = canonicalJson(manifest)
  return sql`
    UPDATE session_export_operations
    SET snapshot_high_water_mark = ${manifest.snapshot.nodeHighWaterMark},
      snapshot_state_revision = ${manifest.snapshot.stateRevision},
      snapshot_captured_at = ${manifest.snapshot.capturedAt}, manifest_json = ${manifestJson},
      updated_at = ${now}
    WHERE id = ${operationId} AND status = ${'running'}
      AND (manifest_json IS NULL OR manifest_json = ${manifestJson})
  `.pipe(Effect.asVoid)
}

function updateProgress(
  sql: SqlClient.SqlClient,
  operationId: string,
  progress: SessionExportProgress,
  now: number,
) {
  return sql`
    UPDATE session_export_operations
    SET records_written = ${progress.recordsWritten},
      resources_written = ${progress.resourcesWritten}, bytes_written = ${progress.bytesWritten},
      updated_at = ${now}
    WHERE id = ${operationId} AND status IN (${'running'}, ${'cancelling'})
  `.pipe(Effect.asVoid)
}

function finish(
  sql: SqlClient.SqlClient,
  operationId: string,
  status: 'completed' | 'cancelled',
  progress: SessionExportProgress | undefined,
  now: number,
) {
  return sql`
    UPDATE session_export_operations
    SET status = ${status}, execution_token = ${null},
      cleanup_pending = ${status === 'cancelled' ? 1 : 0},
      records_written = ${progress?.recordsWritten ?? 0},
      resources_written = ${progress?.resourcesWritten ?? 0},
      bytes_written = ${progress?.bytesWritten ?? 0}, updated_at = ${now}, completed_at = ${now}
    WHERE id = ${operationId} AND (
      (${status} = ${'completed'} AND status IN (${'running'}, ${'installing'}))
      OR (${status} = ${'cancelled'} AND status IN (${'queued'}, ${'running'}, ${'cancelling'}))
    )
  `.pipe(Effect.asVoid)
}

function makeRepository(sql: SqlClient.SqlClient): SessionExportOperationRepositoryShape {
  return {
    create: (input) => withRepositoryError('create-export', createOperation(sql, input)),
    requestCancellation: (input) =>
      withRepositoryError('cancel-export', requestCancellation(sql, input)),
    read: (sessionId, operationId) =>
      withRepositoryError('read-export', readById(sql, sessionId, operationId)),
    claimExecution: (operationId, now) =>
      withRepositoryError('claim-export', claimExecution(sql, operationId, now)),
    persistSnapshot: (operationId, manifest, now) =>
      withRepositoryError(
        'persist-export-snapshot',
        persistSnapshot(sql, operationId, manifest, now),
      ),
    persistArtifactPreparation: (operationId, receipt, now) =>
      withRepositoryError(
        'persist-export-artifact-preparation',
        persistExportArtifactPreparation(sql, operationId, receipt, now),
      ),
    clearArtifactPreparation: (operationId, now) =>
      withRepositoryError(
        'clear-export-artifact-preparation',
        clearExportArtifactPreparation(sql, operationId, now),
      ),
    beginArtifactInstallation: (operationId, now) =>
      withRepositoryError(
        'begin-export-artifact-installation',
        beginExportArtifactInstallation(sql, operationId, now),
      ),
    updateProgress: (operationId, progress, now) =>
      withRepositoryError(
        'update-export-progress',
        updateProgress(sql, operationId, progress, now),
      ),
    cancellationRequested: (operationId) =>
      withRepositoryError(
        'read-export-cancellation',
        sql<{ readonly cancel_requested: number }>`
          SELECT cancel_requested FROM session_export_operations WHERE id = ${operationId}
        `.pipe(Effect.map((rows) => rows[0]?.cancel_requested === 1)),
      ),
    complete: (operationId, progress, now) =>
      withRepositoryError('complete-export', finish(sql, operationId, 'completed', progress, now)),
    fail: (operationId, error, now) =>
      withRepositoryError(
        'fail-export',
        sql`
          UPDATE session_export_operations
          SET status = ${'failed'}, execution_token = ${null}, cleanup_pending = ${1},
            error_json = ${canonicalJson(error)},
            updated_at = ${now}, completed_at = ${now}
          WHERE id = ${operationId}
            AND status IN (${'queued'}, ${'running'}, ${'installing'}, ${'cancelling'})
        `.pipe(Effect.asVoid),
      ),
    cancel: (operationId, now) =>
      withRepositoryError(
        'finish-export-cancellation',
        finish(sql, operationId, 'cancelled', undefined, now),
      ),
    completeCleanup: (operationId, now) =>
      withRepositoryError(
        'complete-export-cleanup',
        sql`
          UPDATE session_export_operations
          SET cleanup_pending = ${0}, updated_at = ${now}
          WHERE id = ${operationId} AND cleanup_pending = ${1}
        `.pipe(Effect.asVoid),
      ),
    listPendingCleanup: withRepositoryError(
      'list-pending-export-cleanup',
      sql<SessionExportOperationRow>`
        SELECT * FROM session_export_operations
        WHERE cleanup_pending = ${1}
        ORDER BY updated_at, id
      `.pipe(Effect.map((rows) => rows.map(sessionExportOperationRecord))),
    ),
    recoverAfterHostLoss: (now) =>
      withRepositoryError('recover-exports', recoverExportOperationsAfterHostLoss(sql, now)),
  }
}

export const SqliteSessionExportOperationRepositoryLive = Layer.effect(
  SessionExportOperationRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionExportOperationRepository.of(makeRepository(sql))
  }),
)
