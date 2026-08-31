import type {
  SessionExportOperationStatus,
  SessionExportProgress,
} from '@shared/types/session-export-operation'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import type {
  SessionExportArtifactSink,
  SessionExportArtifactWriterShape,
} from '../ports/session-export-artifact-writer'
import type {
  SessionExportOperationRecord,
  SessionExportOperationRepositoryShape,
} from '../ports/session-export-operation-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'

const logger = createLogger('session-export/operation')

export function publishSessionExportChange(
  operation: SessionExportOperationRecord,
  status: SessionExportOperationStatus,
  progress: SessionExportProgress,
) {
  publishSessionHostEvent({
    kind: 'session-export-changed',
    sessionId: operation.sessionId,
    exportOperationId: operation.exportOperationId,
    status,
    progress,
  })
}

function discardFailedExport(
  operations: SessionExportOperationRepositoryShape,
  artifacts: SessionExportArtifactWriterShape,
  sink: SessionExportArtifactSink | undefined,
  operation: SessionExportOperationRecord,
) {
  const discard = sink ? sink.discard() : artifacts.discard(operation)
  return discard.pipe(
    Effect.zipRight(operations.completeCleanup(operation.exportOperationId, Date.now())),
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        logger.warn('Export cleanup remains pending after terminal settlement.', {
          cause: String(cause),
          exportOperationId: operation.exportOperationId,
          sessionId: operation.sessionId,
        })
      }),
    ),
  )
}

export function settleFailedSessionExport(input: {
  readonly operations: SessionExportOperationRepositoryShape
  readonly artifacts: SessionExportArtifactWriterShape
  readonly operation: SessionExportOperationRecord
  readonly progress: SessionExportProgress
  readonly sink?: SessionExportArtifactSink
  readonly error: unknown
}) {
  return Effect.gen(function* () {
    if (input.error instanceof Error && input.error.message === 'EXPORT_CANCELLED') {
      yield* input.operations.cancel(input.operation.exportOperationId, Date.now())
      publishSessionExportChange(input.operation, 'cancelled', input.progress)
    } else {
      yield* input.operations.fail(
        input.operation.exportOperationId,
        {
          code: 'export_failed',
          message: input.error instanceof Error ? input.error.message : String(input.error),
        },
        Date.now(),
      )
      publishSessionExportChange(input.operation, 'failed', input.progress)
    }
    yield* discardFailedExport(input.operations, input.artifacts, input.sink, input.operation)
  })
}
