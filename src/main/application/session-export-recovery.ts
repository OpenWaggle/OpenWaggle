import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { SessionExportArtifactWriter } from '../ports/session-export-artifact-writer'
import {
  type SessionExportOperationRecord,
  SessionExportOperationRepository,
} from '../ports/session-export-operation-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { dispatchSessionExport } from './session-export-operation-service'

const logger = createLogger('session-export/recovery')

function publishRecoveryFailure(operation: SessionExportOperationRecord) {
  publishSessionHostEvent({
    kind: 'session-export-changed',
    sessionId: operation.sessionId,
    exportOperationId: operation.exportOperationId,
    status: 'failed',
    progress: operation.progress,
  })
}

export function recoverSessionExportsAfterHostLoss() {
  return Effect.gen(function* () {
    const repository = yield* SessionExportOperationRepository
    const artifacts = yield* SessionExportArtifactWriter
    const recoverable = yield* repository.recoverAfterHostLoss(Date.now())
    const pendingCleanup = yield* repository.listPendingCleanup
    for (const operation of pendingCleanup) {
      yield* artifacts.discard(operation).pipe(
        Effect.zipRight(repository.completeCleanup(operation.exportOperationId, Date.now())),
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            logger.error('Export cleanup remains pending after recovery retry.', {
              cause: String(cause),
              exportOperationId: operation.exportOperationId,
              sessionId: operation.sessionId,
            })
          }),
        ),
      )
    }
    for (const operation of recoverable) {
      if (operation.artifactReceipt && artifacts.verifyInstalled) {
        const verification = yield* artifacts
          .verifyInstalled(operation, operation.artifactReceipt)
          .pipe(Effect.either)
        if (verification._tag === 'Left') {
          yield* repository.fail(
            operation.exportOperationId,
            {
              code: 'export_recovery_verification_failed',
              message:
                'The installed export artifact could not be verified after Session Host loss.',
            },
            Date.now(),
          )
          publishRecoveryFailure(operation)
          continue
        }
        if (verification.right) {
          const cleanup = yield* artifacts.discard(operation).pipe(Effect.either)
          if (cleanup._tag === 'Left') {
            logger.error('Installed export verification succeeded but residual cleanup failed.', {
              cause: String(cleanup.left),
              exportOperationId: operation.exportOperationId,
              sessionId: operation.sessionId,
            })
            continue
          }
          yield* repository.complete(operation.exportOperationId, operation.progress, Date.now())
          publishSessionHostEvent({
            kind: 'session-export-changed',
            sessionId: operation.sessionId,
            exportOperationId: operation.exportOperationId,
            status: 'completed',
            progress: operation.progress,
          })
          continue
        }
        if (repository.clearArtifactPreparation) {
          yield* repository.clearArtifactPreparation(operation.exportOperationId, Date.now())
        }
      }
      const cleaned = yield* artifacts.discard(operation).pipe(
        Effect.zipRight(repository.completeCleanup(operation.exportOperationId, Date.now())),
        Effect.as(true),
        Effect.catchAllCause((cleanupCause) =>
          repository
            .fail(
              operation.exportOperationId,
              {
                code: 'export_recovery_cleanup_failed',
                message: 'The stale export artifact could not be cleaned after Session Host loss.',
              },
              Date.now(),
            )
            .pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  logger.error('Quarantined an export whose stale artifact could not be cleaned.', {
                    cause: String(cleanupCause),
                    exportOperationId: operation.exportOperationId,
                    sessionId: operation.sessionId,
                  })
                  publishRecoveryFailure(operation)
                }),
              ),
              Effect.catchAllCause((settlementCause) =>
                Effect.sync(() => {
                  logger.error('Could not durably quarantine a failed export recovery.', {
                    cleanupCause: String(cleanupCause),
                    settlementCause: String(settlementCause),
                    exportOperationId: operation.exportOperationId,
                    sessionId: operation.sessionId,
                  })
                }),
              ),
              Effect.as(false),
            ),
        ),
      )
      if (cleaned) yield* dispatchSessionExport(operation)
    }
  })
}
