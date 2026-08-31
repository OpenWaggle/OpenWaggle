import * as SqlClient from '@effect/sql/SqlClient'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import {
  SessionExportArtifactWriter,
  type SessionExportArtifactWriterShape,
} from '../../ports/session-export-artifact-writer'
import {
  type SessionExportOperationRecord,
  SessionExportOperationRepository,
  type SessionExportOperationRepositoryShape,
} from '../../ports/session-export-operation-repository'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { recoverSessionExportsAfterHostLoss } from '../session-export-recovery'

const operation: SessionExportOperationRecord = {
  exportOperationId: 'export-recovery',
  sessionId: 'session-export',
  callerId: 'local-user',
  idempotencyKey: 'export-once',
  format: 'jsonl',
  destinationPath: '/tmp/session-export.jsonl',
  temporaryPath: '/tmp/session-export.jsonl.partial',
  overwriteExisting: false,
  cancelRequested: false,
  cleanupPending: false,
  status: 'queued',
  branchScope: 'active-branch',
  includeQueueBodies: false,
  resources: [],
  progress: { recordsWritten: 2, resourcesWritten: 0, bytesWritten: 20 },
  createdAt: 1,
  updatedAt: 2,
}

function recoveryLayer(
  repository: SessionExportOperationRepositoryShape,
  artifacts: SessionExportArtifactWriterShape,
) {
  return Layer.mergeAll(
    Layer.succeed(SessionExportOperationRepository, repository),
    Layer.succeed(SessionExportArtifactWriter, artifacts),
    Layer.succeed(SessionExportResourceResolver, fromPartial({})),
    Layer.succeed(SessionQueryRepository, fromPartial({})),
    Layer.succeed(SqlClient.SqlClient, fromPartial({})),
  )
}

describe('durable Session export recovery', () => {
  it('transitions host-lost exports before enumerating pending cleanup', async () => {
    const order: string[] = []
    const repository = fromPartial<SessionExportOperationRepositoryShape>({
      recoverAfterHostLoss: () =>
        Effect.sync(() => {
          order.push('transitioned')
          return []
        }),
      listPendingCleanup: Effect.sync(() => {
        order.push('cleanup-enumerated')
        return []
      }),
    })
    const artifacts = fromPartial<SessionExportArtifactWriterShape>({})

    await Effect.runPromise(
      recoverSessionExportsAfterHostLoss().pipe(
        Effect.provide(recoveryLayer(repository, artifacts)),
      ),
    )

    expect(order).toEqual(['transitioned', 'cleanup-enumerated'])
  })

  it('completes a verified installed artifact instead of re-exporting it', async () => {
    const completed = vi.fn(() => Effect.void)
    const discard = vi.fn(() => Effect.void)
    const recovered = {
      ...operation,
      artifactReceipt: { sha256: 'installed-digest', sizeBytes: 20 },
    }
    const repository = fromPartial<SessionExportOperationRepositoryShape>({
      recoverAfterHostLoss: () => Effect.succeed([recovered]),
      listPendingCleanup: Effect.succeed([]),
      complete: completed,
    })
    const artifacts = fromPartial<SessionExportArtifactWriterShape>({
      verifyInstalled: () => Effect.succeed(true),
      discard,
    })

    await Effect.runPromise(
      recoverSessionExportsAfterHostLoss().pipe(
        Effect.provide(recoveryLayer(repository, artifacts)),
      ),
    )

    expect(completed).toHaveBeenCalledWith(
      recovered.exportOperationId,
      recovered.progress,
      expect.any(Number),
    )
    expect(discard).toHaveBeenCalledOnce()
  })
})
