import type { SessionExportManifest } from '@shared/types/session-export'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import type {
  SessionExportOperationRecord,
  SessionExportOperationRepositoryShape,
} from '../ports/session-export-operation-repository'
import type { SessionQueryRepositoryShape } from '../ports/session-query-repository'

const EXPORT_PAGE_LIMIT = 500

function exportQuery(
  operation: SessionExportOperationRecord,
  manifest: SessionExportManifest | undefined,
  afterCreatedOrder: number | undefined,
) {
  return {
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId: `${operation.exportOperationId}:${afterCreatedOrder ?? 'first'}`,
    query: {
      operation: 'export' as const,
      sessionId: operation.sessionId,
      limit: EXPORT_PAGE_LIMIT,
      branchScope: operation.branchScope,
      ...(operation.branchId
        ? { branchId: operation.branchId }
        : manifest?.selectedBranchId
          ? { branchId: manifest.selectedBranchId }
          : {}),
      ...(operation.includeQueueBodies ? { includeQueueBodies: true } : {}),
      ...(afterCreatedOrder === undefined ? {} : { afterCreatedOrder }),
      ...(manifest
        ? {
            throughCreatedOrder: manifest.snapshot.nodeHighWaterMark,
            snapshotStateRevision: manifest.snapshot.stateRevision,
            capturedAt: manifest.snapshot.capturedAt,
          }
        : {}),
    },
  }
}

export function readExportPage(
  repository: SessionQueryRepositoryShape,
  operation: SessionExportOperationRecord,
  manifest: SessionExportManifest | undefined,
  afterCreatedOrder: number | undefined,
) {
  return repository.execute({ request: exportQuery(operation, manifest, afterCreatedOrder) }).pipe(
    Effect.flatMap((response) => {
      const outcome = response.outcome
      if (outcome.operation !== 'export' || 'error' in outcome) {
        const message = 'error' in outcome ? outcome.error.message : 'Invalid export response.'
        return Effect.fail(new Error(message))
      }
      return Effect.succeed(outcome)
    }),
  )
}

export function checkExportCancellation(
  repository: SessionExportOperationRepositoryShape,
  operationId: string,
) {
  return repository
    .cancellationRequested(operationId)
    .pipe(
      Effect.flatMap((requested) =>
        requested ? Effect.fail(new Error('EXPORT_CANCELLED')) : Effect.void,
      ),
    )
}
