import type { SessionExportManifest } from '@shared/types/session-export'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  SessionExportArtifactWriter,
  type SessionExportArtifactWriterShape,
} from '../../ports/session-export-artifact-writer'
import { SessionExportLiveAuthority } from '../../ports/session-export-live-authority'
import {
  type SessionExportOperationRecord,
  SessionExportOperationRepository,
  type SessionExportOperationRepositoryShape,
} from '../../ports/session-export-operation-repository'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { SessionQueryRepository } from '../../ports/session-query-repository'

export const exportManifest: SessionExportManifest = {
  schemaVersion: 1,
  sessionId: 'session-export',
  title: 'Export',
  branchScope: 'active-branch',
  activeBranchId: null,
  selectedBranchId: null,
  snapshot: { nodeHighWaterMark: 0, stateRevision: 1, queueRevision: 1, capturedAt: 10 },
  activeRunId: null,
  activeTurnIncomplete: false,
  queue: {
    state: 'running',
    pendingCount: 0,
    bodyScope: 'omitted-by-choice',
    omittedBodyCount: 0,
    items: [],
  },
}

export const exportOperation: SessionExportOperationRecord = {
  exportOperationId: 'export-1',
  sessionId: 'session-export',
  callerId: 'local-user',
  idempotencyKey: 'export-once',
  format: 'jsonl',
  destinationPath: '/tmp/session-export.jsonl',
  temporaryPath: '/tmp/session-export.jsonl.partial',
  overwriteExisting: false,
  cancelRequested: false,
  cleanupPending: false,
  status: 'running',
  branchScope: 'active-branch',
  includeQueueBodies: false,
  resources: [],
  progress: { recordsWritten: 0, resourcesWritten: 0, bytesWritten: 0 },
  createdAt: 1,
  updatedAt: 1,
}

export function exportRepository(overrides: Partial<SessionExportOperationRepositoryShape> = {}) {
  return {
    create: () => Effect.die('unused create'),
    requestCancellation: () => Effect.die('unused cancellation'),
    read: () => Effect.succeed(null),
    claimExecution: () =>
      Effect.succeed({ status: 'claimed' as const, operation: exportOperation }),
    claimNextExecution: () => Effect.succeed({ status: 'not-claimable' as const }),
    persistSnapshot: () => Effect.void,
    updateProgress: () => Effect.void,
    cancellationRequested: () => Effect.succeed(false),
    complete: () => Effect.void,
    fail: () => Effect.void,
    cancel: () => Effect.void,
    completeCleanup: () => Effect.void,
    listPendingCleanup: Effect.succeed([]),
    recoverAfterHostLoss: () => Effect.succeed([]),
    ...overrides,
  } satisfies SessionExportOperationRepositoryShape
}

export function exportTestDependencies(
  operations: SessionExportOperationRepositoryShape,
  artifacts: SessionExportArtifactWriterShape,
  queries = Layer.succeed(SessionQueryRepository, {
    execute: ({ request }) =>
      Effect.succeed({
        contractVersion: 2 as const,
        requestId: request.requestId,
        outcome: { operation: 'export' as const, manifest: exportManifest, records: [] },
      }),
  }),
  resourceResolver = Layer.succeed(SessionExportResourceResolver, {
    resolve: () => Effect.die('unused resource resolver'),
  }),
  liveAuthority: Layer.Layer<SessionExportLiveAuthority, unknown> = Layer.succeed(
    SessionExportLiveAuthority,
    {
      liveAuthorityBlockReason: () => Effect.succeed(undefined),
      loadTarget: () => Effect.die('unused live export target'),
      loadCaller: () => Effect.die('unused live export caller'),
      resolveOriginProfileId: () => Effect.succeed(undefined),
    },
  ),
) {
  return Layer.mergeAll(
    Layer.succeed(SessionExportOperationRepository, operations),
    Layer.succeed(SessionExportArtifactWriter, artifacts),
    queries,
    resourceResolver,
    liveAuthority,
  )
}

export function exportTestLayer(
  operations: SessionExportOperationRepositoryShape,
  artifacts: SessionExportArtifactWriterShape,
) {
  return exportTestDependencies(operations, artifacts)
}
