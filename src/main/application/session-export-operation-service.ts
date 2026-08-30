import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import {
  decodeLocalSessionProfileCapabilities,
  decodeLocalSessionProfileScope,
} from '@shared/schemas/local-session-profile'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  SessionControlMutationResponse,
  SessionExportCreateMutationRequest,
} from '@shared/types/session-control'
import type { SessionExportManifest } from '@shared/types/session-export'
import type {
  SessionExportOperationStatus,
  SessionExportProgress,
} from '@shared/types/session-export-operation'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { liveSessionAuthorityBlockReason } from '../adapters/sqlite-session-live-authority'
import {
  authorizeSessionCapabilities,
  authorizeSessionTarget,
  requiredSessionControlCapabilities,
} from '../domain/session-control/session-capability-authorization'
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
import {
  SessionQueryRepository,
  type SessionQueryRepositoryShape,
} from '../ports/session-query-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'
import { assertFilesystemReadDirectoryScope } from '../utils/filesystem-read-directory-scope'
import { prepareDurableExportInstallation } from './session-export-artifact-installation'
import { forkSupervisedSessionExport } from './session-export-supervision'
import { acquireSessionHostRunLease, type SessionHostRunLease } from './session-host-run-admission'

const EXPORT_PAGE_LIMIT = 500
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

function readExportPage(
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

function checkCancellation(repository: SessionExportOperationRepositoryShape, operationId: string) {
  return repository
    .cancellationRequested(operationId)
    .pipe(
      Effect.flatMap((requested) =>
        requested ? Effect.fail(new Error('EXPORT_CANCELLED')) : Effect.void,
      ),
    )
}

function ensureLiveExportAuthority(
  sql: SqlClient.SqlClient,
  operation: SessionExportOperationRecord,
) {
  return Effect.gen(function* () {
    const expectedWorkspacePath =
      operation.resources.length > 0 ? operation.resourceSourceRoot : undefined
    if (operation.resources.length > 0 && !expectedWorkspacePath) {
      return yield* Effect.fail(new Error('Export resource source authority is unavailable.'))
    }
    if (
      !operation.callerId.startsWith('profile:') &&
      !operation.callerId.startsWith('session-agent:') &&
      !operation.callerId.startsWith('transient-mcp:')
    ) {
      return expectedWorkspacePath
    }
    const reason = yield* liveSessionAuthorityBlockReason(
      sql,
      operation.callerId,
      operation.sessionId,
    )
    if (reason)
      return yield* Effect.fail(new Error(`Export authority is no longer valid: ${reason}.`))
    if (!operation.callerId.startsWith('profile:')) return expectedWorkspacePath
    const profileId = operation.callerId.slice('profile:'.length)
    const rows = yield* sql<{
      readonly id: string
      readonly capabilities_json: string
      readonly scope_json: string
      readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
      readonly session_id: string
      readonly project_path: string | null
      readonly hive_root_session_id: string | null
      readonly working_path: string | null
    }>`
      SELECT profiles.id, profiles.capabilities_json, profiles.scope_json,
        profiles.authorization_ceiling, sessions.id AS session_id, sessions.project_path,
        lineage.hive_root_session_id, workspace_resources.working_path
      FROM session_client_profiles AS profiles
      JOIN sessions ON sessions.id = ${operation.sessionId}
      LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = sessions.id
      LEFT JOIN session_workspace_bindings AS bindings ON bindings.session_id = sessions.id
      LEFT JOIN workspace_resources ON workspace_resources.id = bindings.workspace_id
      WHERE profiles.id = ${profileId} AND profiles.revoked_at IS NULL
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return yield* Effect.fail(new Error('Export profile was revoked.'))
    const authority = {
      profileId: row.id,
      profileName: row.id,
      capabilities: decodeLocalSessionProfileCapabilities(parseJsonUnknown(row.capabilities_json)),
      scope: decodeLocalSessionProfileScope(parseJsonUnknown(row.scope_json)),
      authorizationCeiling: row.authorization_ceiling,
    }
    const exportRoots = authority.scope.exportRoots ?? []
    if (!operation.destinationRoot || exportRoots.length === 0) {
      return yield* Effect.fail(new Error('Export filesystem authority was removed.'))
    }
    const currentWorkspacePath = yield* Effect.tryPromise({
      try: async () => {
        const canonicalRoots = await assertCanonicalDirectoryRoots(
          exportRoots,
          'Profile export root',
        )
        const [destinationRoot] = await assertCanonicalDirectoryRoots(
          [operation.destinationRoot ?? ''],
          'Export destination root',
        )
        const isAuthorizedRoot = (candidate: string) =>
          canonicalRoots.some((root) => {
            const relative = path.relative(root, candidate)
            return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
          })
        if (!isAuthorizedRoot(destinationRoot ?? '')) {
          throw new Error('Export destination root is no longer authorized.')
        }
        if (operation.resources.length === 0) return undefined
        const sourceRoot = row.working_path ?? row.project_path
        if (!sourceRoot) throw new Error('Export resource source root is unavailable.')
        const [canonicalSourceRoot] = await assertCanonicalDirectoryRoots(
          [sourceRoot],
          'Export resource source root',
        )
        if (!canonicalSourceRoot || !isAuthorizedRoot(canonicalSourceRoot)) {
          throw new Error('Export resource source root is no longer authorized.')
        }
        return canonicalSourceRoot
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })
    const requiredCapabilities = requiredSessionControlCapabilities({
      operation: 'export-create',
      sessionId: operation.sessionId,
      format: operation.format,
      destinationPath: operation.destinationPath,
      branchScope: operation.branchScope,
      ...(operation.branchId ? { branchId: operation.branchId } : {}),
      ...(operation.overwriteExisting ? { overwriteExisting: true } : {}),
      ...(operation.includeQueueBodies ? { includeQueueBodies: true } : {}),
      ...(operation.resources.length > 0 ? { resources: operation.resources } : {}),
    })
    if (
      !authorizeSessionCapabilities(authority, requiredCapabilities).authorized ||
      !authorizeSessionTarget(authority, {
        sessionId: row.session_id,
        ...(row.project_path ? { projectPath: row.project_path } : {}),
        hiveRootSessionId: row.hive_root_session_id ?? row.session_id,
      }).authorized
    ) {
      return yield* Effect.fail(new Error('Export profile authority changed.'))
    }
    if (currentWorkspacePath !== expectedWorkspacePath) {
      return yield* Effect.fail(new Error('Export resource source workspace changed.'))
    }
    return expectedWorkspacePath
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
        yield* checkCancellation(operations, operation.exportOperationId)
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
        yield* checkCancellation(operations, operation.exportOperationId)
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
      yield* checkCancellation(operations, operation.exportOperationId)
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
