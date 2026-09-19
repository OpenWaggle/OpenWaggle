import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import { createLogger } from '../logger'
import { SessionExportArtifactWriter } from '../ports/session-export-artifact-writer'
import {
  type SessionExportOperationRecord,
  SessionExportOperationRepository,
} from '../ports/session-export-operation-repository'
import {
  publishSessionHostEvent,
  tryGetSessionHostEventRuntime,
} from '../session-host/session-host-events'
import { drainSessionExportQueue } from './session-export-operation-service'
import { acquireSessionHostRunLease } from './session-host-run-admission'

const logger = createLogger('session-export/recovery')
const RECOVERY_RETRY_INTERVAL = '1 second'

function publishRecoveryStatus(operation: SessionExportOperationRecord) {
  return Effect.gen(function* () {
    const repository = yield* SessionExportOperationRepository
    const current = yield* repository.read(operation.sessionId, operation.exportOperationId)
    if (!current) return
    publishSessionHostEvent({
      kind: 'session-export-changed',
      sessionId: current.sessionId,
      exportOperationId: current.exportOperationId,
      status: current.status,
      progress: current.progress,
    })
  })
}

function discardRecoveryArtifact(operation: SessionExportOperationRecord) {
  return Effect.gen(function* () {
    const repository = yield* SessionExportOperationRepository
    const artifacts = yield* SessionExportArtifactWriter
    yield* artifacts.discard(operation)
    yield* repository.completeCleanup(operation.exportOperationId, Date.now())
  })
}

function retryPendingCleanup(operation: SessionExportOperationRecord) {
  return discardRecoveryArtifact(operation).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        logger.error('Export cleanup remains pending after recovery retry.', {
          error: String(error),
          exportOperationId: operation.exportOperationId,
          sessionId: operation.sessionId,
        })
      }),
    ),
  )
}

function recoverOperation(operation: SessionExportOperationRecord) {
  return Effect.gen(function* () {
    const repository = yield* SessionExportOperationRepository
    const artifacts = yield* SessionExportArtifactWriter
    if (operation.status !== 'queued') {
      if (operation.cleanupPending) yield* retryPendingCleanup(operation)
      return
    }
    if (operation.artifactReceipt && artifacts.verifyInstalled) {
      const verification = yield* artifacts
        .verifyInstalled(operation, operation.artifactReceipt)
        .pipe(Effect.either)
      // Cancellation remains available while background recovery checks the filesystem.
      const current = yield* repository.read(operation.sessionId, operation.exportOperationId)
      if (!current) return
      if (current.status !== 'queued') {
        if (current.cleanupPending) yield* retryPendingCleanup(current)
        return
      }
      if (verification._tag === 'Left') {
        yield* repository.fail(
          operation.exportOperationId,
          {
            code: 'export_recovery_verification_failed',
            message: 'The installed export artifact could not be verified after Session Host loss.',
          },
          Date.now(),
        )
        yield* publishRecoveryStatus(operation)
        return
      }
      if (verification.right) {
        yield* repository.complete(operation.exportOperationId, operation.progress, Date.now(), {
          cleanupPending: true,
        })
        yield* publishRecoveryStatus(operation)
        yield* retryPendingCleanup(operation)
        return
      }
      if (repository.clearArtifactPreparation) {
        yield* repository.clearArtifactPreparation(operation.exportOperationId, Date.now())
      }
    }
    yield* discardRecoveryArtifact(operation).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          // A failed settlement must leave the page fenced so the worker can retry it.
          yield* repository.fail(
            operation.exportOperationId,
            {
              code: 'export_recovery_cleanup_failed',
              message: 'The stale export artifact could not be cleaned after Session Host loss.',
            },
            Date.now(),
          )
          logger.error('Quarantined an export whose stale artifact could not be cleaned.', {
            error: String(error),
            exportOperationId: operation.exportOperationId,
            sessionId: operation.sessionId,
          })
          yield* publishRecoveryStatus(operation)
        }),
      ),
    )
  })
}

/** Startup fences claims and captures a high-water mark without hydrating exports or touching files. */
export function recoverSessionExportsAfterHostLoss() {
  return Effect.gen(function* () {
    const repository = yield* SessionExportOperationRepository
    yield* repository.beginRecovery
  })
}

export function continueSessionExportRecovery() {
  return Effect.gen(function* () {
    const repository = yield* SessionExportOperationRepository
    while (yield* repository.recoveryPending) {
      if (tryGetSessionHostEventRuntime()?.liveness.isDraining()) return
      const page = yield* repository.recoverAfterHostLoss(Date.now())
      for (const operation of page) yield* recoverOperation(operation)
      yield* repository.completeRecoveryPage
      yield* Effect.yieldNow()
    }
    if (tryGetSessionHostEventRuntime()?.liveness.isDraining()) return
    yield* drainSessionExportQueue()
  })
}

export const runSessionExportRecoveryBackground = Effect.forkScoped(
  Effect.acquireUseRelease(
    acquireSessionHostRunLease('export'),
    () =>
      continueSessionExportRecovery().pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            logger.error('Export recovery page remains fenced and will retry.', {
              error: String(error),
            })
          }),
        ),
        Effect.retry(Schedule.spaced(RECOVERY_RETRY_INTERVAL)),
      ),
    (lease) => Effect.sync(lease.release),
  ).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        if (Cause.isInterruptedOnly(cause)) return
        logger.error('Export recovery stopped; draining Session Host for recovery.', {
          cause: Cause.pretty(cause),
        })
        tryGetSessionHostEventRuntime()?.liveness.requestDrain()
      }),
    ),
  ),
)
