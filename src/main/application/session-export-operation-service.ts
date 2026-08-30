import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  SessionControlMutationResponse,
  SessionExportCreateMutationRequest,
} from '@shared/types/session-control'
import type {
  SessionExportOperationStatus,
  SessionExportProgress,
} from '@shared/types/session-export-operation'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import type {
  SessionExportArtifactSink,
  SessionExportArtifactWriterShape,
} from '../ports/session-export-artifact-writer'
import { SessionExportArtifactWriter } from '../ports/session-export-artifact-writer'
import {
  type SessionExportOperationRecord,
  SessionExportOperationRepository,
  type SessionExportOperationRepositoryShape,
} from '../ports/session-export-operation-repository'
import { SessionExportResourceResolver } from '../ports/session-export-resource-resolver'
import { SessionQueryRepository } from '../ports/session-query-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'
import { assertFilesystemReadDirectoryScope } from '../utils/filesystem-read-directory-scope'
import { prepareDurableExportInstallation } from './session-export-artifact-installation'
import { ensureLiveExportAuthority } from './session-export-live-authority'
import { checkExportCancellation, readExportPage } from './session-export-query'
import { forkSupervisedSessionExport } from './session-export-supervision'
import { acquireSessionHostRunLease, type SessionHostRunLease } from './session-host-run-admission'

const logger = createLogger('session-export/operation')

function publishExportChange(
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

function describeExportError(error: unknown) {
  return {
    code: 'export_failed',
    message: error instanceof Error ? error.message : String(error),
  }
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

function settleFailedExport(input: {
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
      publishExportChange(input.operation, 'cancelled', input.progress)
    } else {
      yield* input.operations.fail(
        input.operation.exportOperationId,
        describeExportError(input.error),
        Date.now(),
      )
      publishExportChange(input.operation, 'failed', input.progress)
    }
    yield* discardFailedExport(input.operations, input.artifacts, input.sink, input.operation)
  })
}

function runClaimedExport(operation: SessionExportOperationRecord) {
  return Effect.gen(function* () {
    const operations = yield* SessionExportOperationRepository
    const queries = yield* SessionQueryRepository
    const artifacts = yield* SessionExportArtifactWriter
    const resources = yield* SessionExportResourceResolver
    const sql = yield* SqlClient.SqlClient
    let sink: SessionExportArtifactSink | undefined
    let durableInstallPrepared = false
    let progress = { recordsWritten: 0, resourcesWritten: 0, bytesWritten: 0 }
    yield* Effect.gen(function* () {
      yield* ensureLiveExportAuthority(sql, operation)
      const openedSink = yield* artifacts.open(operation)
      sink = openedSink
      let page = yield* readExportPage(queries, operation, operation.manifest, undefined)
      const manifest = operation.manifest ?? page.manifest
      yield* operations.persistSnapshot(operation.exportOperationId, manifest, Date.now())
      progress = {
        ...progress,
        bytesWritten: progress.bytesWritten + (yield* openedSink.writeManifest(manifest)),
      }
      while (true) {
        yield* checkExportCancellation(operations, operation.exportOperationId)
        yield* ensureLiveExportAuthority(sql, operation)
        const bytes = yield* openedSink.writeRecords(page.records)
        progress = {
          ...progress,
          recordsWritten: progress.recordsWritten + page.records.length,
          bytesWritten: progress.bytesWritten + bytes,
        }
        yield* operations.updateProgress(operation.exportOperationId, progress, Date.now())
        publishExportChange(operation, 'running', progress)
        if (page.nextCreatedOrder === undefined) break
        page = yield* readExportPage(queries, operation, manifest, page.nextCreatedOrder)
      }
      for (const resource of operation.resources) {
        yield* checkExportCancellation(operations, operation.exportOperationId)
        const expectedWorkspacePath = yield* ensureLiveExportAuthority(sql, operation)
        const bytes = yield* Effect.acquireUseRelease(
          resources.resolve({
            sessionId: operation.sessionId,
            resource,
            ...(expectedWorkspacePath ? { expectedWorkspacePath } : {}),
          }),
          (resolved) =>
            openedSink.writeResource({
              path: resolved.path,
              sourceHandle: resolved.sourceHandle,
            }),
          (resolved) => Effect.promise(() => resolved.sourceHandle.close().catch(() => undefined)),
        )
        progress = {
          ...progress,
          resourcesWritten: progress.resourcesWritten + 1,
          bytesWritten: progress.bytesWritten + bytes,
        }
        yield* operations.updateProgress(operation.exportOperationId, progress, Date.now())
        publishExportChange(operation, 'running', progress)
      }
      yield* checkExportCancellation(operations, operation.exportOperationId)
      yield* ensureLiveExportAuthority(sql, operation)
      const installation = yield* prepareDurableExportInstallation({
        operationId: operation.exportOperationId,
        sink: openedSink,
        operations,
      })
      if (installation === false) return yield* Effect.fail(new Error('EXPORT_CANCELLED'))
      if (installation === true) durableInstallPrepared = true
      if (installation === undefined) {
        yield* openedSink.finalize()
        yield* operations.complete(operation.exportOperationId, progress, Date.now())
        publishExportChange(operation, 'completed', progress)
      }
    }).pipe(
      Effect.catchAll((error) =>
        settleFailedExport({
          operations,
          artifacts,
          operation,
          progress,
          ...(sink ? { sink } : {}),
          error,
        }),
      ),
    )
    if (durableInstallPrepared && sink) {
      yield* ensureLiveExportAuthority(sql, operation)
      yield* sink.finalize()
      yield* operations.complete(operation.exportOperationId, progress, Date.now())
      publishExportChange(operation, 'completed', progress)
    }
  })
}

export function runSessionExportOperation(
  exportOperationId: string,
  admittedLease?: SessionHostRunLease,
) {
  return Effect.gen(function* () {
    const operations = yield* SessionExportOperationRepository
    const lease = admittedLease ?? (yield* acquireSessionHostRunLease('export'))
    yield* Effect.gen(function* () {
      const claim = yield* operations.claimExecution(exportOperationId, Date.now())
      if (claim.status === 'claimed') yield* runClaimedExport(claim.operation)
    }).pipe(Effect.ensuring(Effect.sync(lease.release)))
  })
}

export function dispatchSessionExport(
  operation: SessionExportOperationRecord,
  lease?: SessionHostRunLease,
) {
  return operation.status === 'queued'
    ? forkSupervisedSessionExport({
        operation,
        effect: runSessionExportOperation(operation.exportOperationId, lease),
      }).pipe(Effect.as(true))
    : Effect.succeed(false)
}

export function createSessionExport(input: {
  readonly callerId: string
  readonly authority?: LocalSessionProfileAuthority
  readonly request: SessionExportCreateMutationRequest
}) {
  return Effect.gen(function* () {
    if (input.request.command.resources?.length && input.request.command.format !== 'bundle') {
      return yield* Effect.fail(new Error('Bundled resources require the bundle export format.'))
    }
    let resourceSourceRoot: string | undefined
    if (input.request.command.resources?.length) {
      const targetRepository = yield* SessionAuthorizationTargetRepository
      const target = yield* targetRepository.resolve(input.request.command.sessionId)
      const sourceRoot = target.workingPath ?? target.projectPath
      resourceSourceRoot = yield* Effect.tryPromise({
        try: async () => {
          if (!input.authority) {
            const [canonicalSourceRoot] = await assertCanonicalDirectoryRoots(
              [sourceRoot],
              'Export resource source root',
            )
            if (!canonicalSourceRoot) throw new Error('Export resource source root is unavailable.')
            return canonicalSourceRoot
          }
          const roots = await assertCanonicalDirectoryRoots(
            input.authority.scope.exportRoots ?? [],
            'Profile export root',
          )
          if (roots.length === 0) throw new Error('Export filesystem authority was removed.')
          return assertFilesystemReadDirectoryScope({
            roots,
            directoryPath: sourceRoot,
            label: 'Export resource source root',
          })
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
    }
    const repository = yield* SessionExportOperationRepository
    const lease = yield* acquireSessionHostRunLease('export')
    let transferred = false
    return yield* Effect.gen(function* () {
      const result = yield* repository.create({
        callerId: input.callerId,
        idempotencyKey: input.request.idempotencyKey,
        command: input.request.command,
        ...(resourceSourceRoot ? { resourceSourceRoot } : {}),
        now: Date.now(),
      })
      transferred = yield* dispatchSessionExport(result.operation, lease)
      return {
        contractVersion: input.request.contractVersion,
        requestId: input.request.requestId,
        idempotencyKey: input.request.idempotencyKey,
        replayed: result.replayed,
        outcome: {
          operation: 'export-create',
          effect: 'export-accepted',
          sessionId: result.operation.sessionId,
          exportOperationId: result.operation.exportOperationId,
          status: result.operation.status,
        },
      } satisfies SessionControlMutationResponse
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (!transferred) lease.release()
        }),
      ),
    )
  })
}
