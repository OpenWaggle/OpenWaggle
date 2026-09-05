import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  SessionControlMutationResponse,
  SessionExportCreateMutationRequest,
} from '@shared/types/session-control'
import {
  SESSION_EXPORT_GLOBAL_CONCURRENCY_LIMIT,
  SESSION_EXPORT_RESOURCE_BYTES_LIMIT,
} from '@shared/types/session-export-operation'
import * as Effect from 'effect/Effect'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import type { SessionExportArtifactSink } from '../ports/session-export-artifact-writer'
import { SessionExportArtifactWriter } from '../ports/session-export-artifact-writer'
import {
  type SessionExportOperationRecord,
  SessionExportOperationRepository,
} from '../ports/session-export-operation-repository'
import { SessionExportResourceResolver } from '../ports/session-export-resource-resolver'
import { SessionQueryRepository } from '../ports/session-query-repository'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'
import { assertFilesystemReadDirectoryScope } from '../utils/filesystem-read-directory-scope'
import {
  acquireLocalSessionProfileBackgroundWork,
  type LocalSessionProfileBackgroundWorkLease,
} from './local-session-profile-background-work'
import { prepareDurableExportInstallation } from './session-export-artifact-installation'
import {
  ensureLiveExportAuthority,
  resolveExportOriginProfileId,
} from './session-export-live-authority'
import {
  publishSessionExportChange,
  settleFailedSessionExport,
} from './session-export-operation-settlement'
import { checkExportCancellation, readExportPage } from './session-export-query'
import { forkSupervisedSessionExport } from './session-export-supervision'
import { acquireSessionHostRunLease, type SessionHostRunLease } from './session-host-run-admission'

type SessionExportExecutionDependencies =
  | SqlClient.SqlClient
  | SessionExportArtifactWriter
  | SessionExportOperationRepository
  | SessionExportResourceResolver
  | SessionQueryRepository

function checkProfileFence(lease: LocalSessionProfileBackgroundWorkLease | undefined) {
  return lease?.signal?.aborted
    ? Effect.fail(
        lease.signal.reason instanceof Error
          ? lease.signal.reason
          : new Error('Profile authority changed.'),
      )
    : Effect.void
}

function runClaimedExport(operation: SessionExportOperationRecord) {
  return Effect.gen(function* () {
    const operations = yield* SessionExportOperationRepository
    const queries = yield* SessionQueryRepository
    const artifacts = yield* SessionExportArtifactWriter
    const resources = yield* SessionExportResourceResolver
    const sql = yield* SqlClient.SqlClient
    const originProfileId = yield* resolveExportOriginProfileId(sql, operation)
    const profileLease = originProfileId
      ? acquireLocalSessionProfileBackgroundWork(originProfileId, { cancelOnFence: true })
      : { release: () => undefined }
    let sink: SessionExportArtifactSink | undefined
    let durableInstallPrepared = false
    let progress = { recordsWritten: 0, resourcesWritten: 0, bytesWritten: 0 }
    let resourceBytesWritten = 0
    yield* Effect.gen(function* () {
      if (!profileLease) return yield* Effect.fail(new Error('Profile authority is changing.'))
      yield* checkProfileFence(profileLease)
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
        yield* checkProfileFence(profileLease)
        yield* checkExportCancellation(operations, operation.exportOperationId)
        yield* ensureLiveExportAuthority(sql, operation)
        const bytes = yield* openedSink.writeRecords(page.records)
        progress = {
          ...progress,
          recordsWritten: progress.recordsWritten + page.records.length,
          bytesWritten: progress.bytesWritten + bytes,
        }
        yield* operations.updateProgress(operation.exportOperationId, progress, Date.now())
        publishSessionExportChange(operation, 'running', progress)
        if (page.nextCreatedOrder === undefined) break
        page = yield* readExportPage(queries, operation, manifest, page.nextCreatedOrder)
      }
      for (const resource of operation.resources) {
        yield* checkProfileFence(profileLease)
        yield* checkExportCancellation(operations, operation.exportOperationId)
        const expectedWorkspacePath = yield* ensureLiveExportAuthority(sql, operation)
        const bytes = yield* Effect.acquireUseRelease(
          resources.resolve({
            sessionId: operation.sessionId,
            resource,
            ...(expectedWorkspacePath ? { expectedWorkspacePath } : {}),
          }),
          (resolved) => {
            if (resolved.size > SESSION_EXPORT_RESOURCE_BYTES_LIMIT - resourceBytesWritten) {
              return Effect.fail(
                new Error('Export resources exceed the 256 MiB aggregate byte limit.'),
              )
            }
            return openedSink.writeResource({
              path: resolved.path,
              sourceHandle: resolved.sourceHandle,
              expectedSize: resolved.size,
              expectedIdentity: resolved.identity,
            })
          },
          (resolved) => Effect.promise(() => resolved.sourceHandle.close().catch(() => undefined)),
        )
        yield* checkProfileFence(profileLease)
        progress = {
          ...progress,
          resourcesWritten: progress.resourcesWritten + 1,
          bytesWritten: progress.bytesWritten + bytes,
        }
        resourceBytesWritten += bytes
        yield* operations.updateProgress(operation.exportOperationId, progress, Date.now())
        publishSessionExportChange(operation, 'running', progress)
      }
      yield* checkProfileFence(profileLease)
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
        yield* checkProfileFence(profileLease)
        yield* openedSink.finalize()
        yield* operations.complete(operation.exportOperationId, progress, Date.now())
        publishSessionExportChange(operation, 'completed', progress)
      }
      if (durableInstallPrepared && sink) {
        yield* checkProfileFence(profileLease)
        yield* ensureLiveExportAuthority(sql, operation)
        yield* sink.finalize()
        yield* operations.complete(operation.exportOperationId, progress, Date.now())
        publishSessionExportChange(operation, 'completed', progress)
      }
    }).pipe(
      Effect.catchAll((error) =>
        settleFailedSessionExport({
          operations,
          artifacts,
          operation,
          progress,
          ...(sink ? { sink } : {}),
          error,
        }),
      ),
      Effect.ensuring(Effect.sync(() => profileLease?.release())),
    )
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

export function drainSessionExportQueue(
  admittedLease?: SessionHostRunLease,
): Effect.Effect<void, unknown, SessionExportExecutionDependencies> {
  return Effect.gen(function* () {
    const operations = yield* SessionExportOperationRepository
    let availableLease = admittedLease
    for (let index = 0; index < SESSION_EXPORT_GLOBAL_CONCURRENCY_LIMIT; index += 1) {
      const lease = availableLease ?? (yield* acquireSessionHostRunLease('export'))
      availableLease = undefined
      let transferred = false
      const claimed = yield* Effect.gen(function* () {
        const claim = yield* operations.claimNextExecution(Date.now())
        if (claim.status === 'not-claimable') return false
        transferred = true
        yield* forkSupervisedSessionExport({
          operation: claim.operation,
          effect: runClaimedExport(claim.operation).pipe(
            Effect.ensuring(
              drainSessionExportQueue().pipe(
                Effect.ensuring(Effect.sync(lease.release)),
                Effect.orDie,
              ),
            ),
          ),
        })
        return true
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (!transferred) lease.release()
          }),
        ),
      )
      if (!claimed) return
    }
  })
}

export function dispatchSessionExport(
  operation: SessionExportOperationRecord,
  lease?: SessionHostRunLease,
) {
  return operation.status === 'queued'
    ? drainSessionExportQueue(lease).pipe(Effect.as(true))
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
        ...(input.authority ? { originProfileId: input.authority.profileId } : {}),
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
