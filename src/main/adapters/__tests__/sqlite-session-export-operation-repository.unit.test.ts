import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionExportManifest } from '@shared/types/session-export'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  makeSessionExportOperationRuntime,
  withSessionExportOperationRepository,
} from './sqlite-session-export-operation-test-layer'

const manifest: SessionExportManifest = {
  schemaVersion: 1,
  sessionId: 'session-1',
  title: 'Export me',
  branchScope: 'active-branch',
  activeBranchId: 'branch-1',
  selectedBranchId: 'branch-1',
  snapshot: { nodeHighWaterMark: 12, stateRevision: 4, queueRevision: 2, capturedAt: 20 },
  activeRunId: null,
  activeTurnIncomplete: false,
  queue: {
    state: 'running',
    pendingCount: 1,
    bodyScope: 'included',
    omittedBodyCount: 0,
    items: [
      {
        followUpId: 'follow-up-1',
        position: 0,
        createdAt: 19,
        deliveryState: 'pending',
        intent: { text: 'stored queue body' },
      },
    ],
  },
}

describe('SQLite Session export operation repository', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeSessionExportOperationRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-operation-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  function runtime() {
    const created = makeSessionExportOperationRuntime(path.join(temporaryRoot, 'exports.sqlite'))
    runtimes.push(created)
    return created
  }

  it('replays creation and persists snapshot, progress, and completion', async () => {
    const active = runtime()
    const result = await withSessionExportOperationRepository(active, (repository) =>
      Effect.gen(function* () {
        const input = {
          callerId: 'cli-1',
          idempotencyKey: 'export-once',
          command: {
            operation: 'export-create' as const,
            sessionId: 'session-1',
            format: 'jsonl' as const,
            destinationPath: path.join(temporaryRoot, 'session.jsonl'),
            destinationRoot: temporaryRoot,
          },
          resourceSourceRoot: temporaryRoot,
          now: 10,
        }
        const created = yield* repository.create(input)
        const replayed = yield* repository.create(input)
        const claim = yield* repository.claimExecution(created.operation.exportOperationId, 11)
        yield* repository.persistSnapshot(created.operation.exportOperationId, manifest, 12)
        if (!repository.persistArtifactPreparation) {
          return yield* Effect.die('artifact preparation persistence unavailable')
        }
        yield* repository.persistArtifactPreparation(
          created.operation.exportOperationId,
          { sha256: 'installed-digest', sizeBytes: 2048 },
          12,
        )
        yield* repository.updateProgress(
          created.operation.exportOperationId,
          { recordsWritten: 12, resourcesWritten: 0, bytesWritten: 2048 },
          13,
        )
        yield* repository.complete(
          created.operation.exportOperationId,
          { recordsWritten: 12, resourcesWritten: 0, bytesWritten: 2048 },
          14,
        )
        const completed = yield* repository.read('session-1', created.operation.exportOperationId)
        return { created, replayed, claim, completed }
      }),
    )

    expect(result.created.replayed).toBe(false)
    expect(result.created.operation.destinationRoot).toBe(temporaryRoot)
    expect(result.created.operation.resourceSourceRoot).toBe(temporaryRoot)
    expect(result.replayed).toMatchObject({
      replayed: true,
      operation: { exportOperationId: result.created.operation.exportOperationId },
    })
    expect(result.claim.status).toBe('claimed')
    expect(result.completed).toMatchObject({
      status: 'completed',
      manifest,
      artifactReceipt: { sha256: 'installed-digest', sizeBytes: 2048 },
      progress: { recordsWritten: 12, resourcesWritten: 0, bytesWritten: 2048 },
      completedAt: 14,
    })
    const persisted = await active.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{
          readonly manifest_json: string
          readonly manifest_summary_json: string
        }>`
          SELECT manifest_json, manifest_summary_json
          FROM session_export_operations
          WHERE id = ${result.created.operation.exportOperationId}
        `
      }),
    )
    expect(persisted[0]?.manifest_json).toContain('stored queue body')
    expect(persisted[0]?.manifest_summary_json).not.toContain('stored queue body')
  })

  it('turns running exports back into queued work and finishes requested cancellation', async () => {
    const active = runtime()
    const result = await withSessionExportOperationRepository(active, (repository) =>
      Effect.gen(function* () {
        const first = yield* repository.create({
          callerId: 'cli-1',
          idempotencyKey: 'resume-me',
          command: {
            operation: 'export-create',
            sessionId: 'session-1',
            format: 'markdown',
            destinationPath: path.join(temporaryRoot, 'resume.md'),
          },
          now: 1,
        })
        const second = yield* repository.create({
          callerId: 'cli-1',
          idempotencyKey: 'cancel-me',
          command: {
            operation: 'export-create',
            sessionId: 'session-1',
            format: 'bundle',
            destinationPath: path.join(temporaryRoot, 'cancel.zip'),
          },
          now: 2,
        })
        yield* repository.claimExecution(first.operation.exportOperationId, 3)
        yield* repository.claimExecution(second.operation.exportOperationId, 3)
        yield* repository.requestCancellation({
          sessionId: 'session-1',
          exportOperationId: second.operation.exportOperationId,
          now: 4,
        })
        yield* repository.beginRecovery
        const recoverable = yield* repository.recoverAfterHostLoss(5)
        const resumed = yield* repository.read('session-1', first.operation.exportOperationId)
        const cancelled = yield* repository.read('session-1', second.operation.exportOperationId)
        return { recoverable, resumed, cancelled }
      }),
    )

    expect(result.recoverable).toHaveLength(2)
    expect(result.recoverable[0]?.exportOperationId).toBe(result.resumed?.exportOperationId)
    expect(result.resumed?.status).toBe('queued')
    expect(result.cancelled).toMatchObject({ status: 'cancelled', completedAt: 5 })
  })

  it('durably completes a verified installation after host-loss recovery', async () => {
    const active = runtime()
    const result = await withSessionExportOperationRepository(active, (repository) =>
      Effect.gen(function* () {
        const created = yield* repository.create({
          callerId: 'cli-1',
          idempotencyKey: 'recover-installed',
          command: {
            operation: 'export-create',
            sessionId: 'session-1',
            format: 'jsonl',
            destinationPath: path.join(temporaryRoot, 'installed.jsonl'),
          },
          now: 1,
        })
        const operationId = created.operation.exportOperationId
        yield* repository.claimExecution(operationId, 2)
        if (!repository.persistArtifactPreparation || !repository.beginArtifactInstallation) {
          return yield* Effect.die('durable artifact installation unavailable')
        }
        yield* repository.persistArtifactPreparation(
          operationId,
          { sha256: 'installed-digest', sizeBytes: 20 },
          3,
        )
        const installationClaimed = yield* repository.beginArtifactInstallation(operationId, 4)
        yield* repository.beginRecovery
        const recovered = yield* repository.recoverAfterHostLoss(5)
        const recoveredOperation = recovered[0]
        if (!recoveredOperation) return yield* Effect.die('installed export was not recovered')
        yield* repository.complete(operationId, recoveredOperation.progress, 6)
        return {
          installationClaimed,
          recoveredOperation,
          completed: yield* repository.read('session-1', operationId),
          nextClaim: yield* repository.claimNextExecution(7),
        }
      }),
    )

    expect(result.installationClaimed).toBe(true)
    expect(result.recoveredOperation).toMatchObject({
      status: 'queued',
      artifactReceipt: { sha256: 'installed-digest', sizeBytes: 20 },
    })
    expect(result.completed).toMatchObject({ status: 'completed', completedAt: 6 })
    expect(result.nextClaim).toEqual({ status: 'not-claimable' })
  })

  it('allows only one background writer to claim a replayed export', async () => {
    const active = runtime()
    const claims = await withSessionExportOperationRepository(active, (repository) =>
      Effect.gen(function* () {
        const created = yield* repository.create({
          callerId: 'cli-1',
          idempotencyKey: 'claim-once',
          command: {
            operation: 'export-create',
            sessionId: 'session-1',
            format: 'jsonl',
            destinationPath: path.join(temporaryRoot, 'claim.jsonl'),
          },
          now: 1,
        })
        return yield* Effect.all(
          [
            repository.claimExecution(created.operation.exportOperationId, 2),
            repository.claimExecution(created.operation.exportOperationId, 2),
          ],
          { concurrency: 'unbounded' },
        )
      }),
    )

    expect(claims.filter((claim) => claim.status === 'claimed')).toHaveLength(1)
    expect(claims.filter((claim) => claim.status === 'not-claimable')).toHaveLength(1)
  })

  it('does not let completion overwrite cancellation before installation is claimed', async () => {
    const active = runtime()
    const result = await withSessionExportOperationRepository(active, (repository) =>
      Effect.gen(function* () {
        const created = yield* repository.create({
          callerId: 'cli-1',
          idempotencyKey: 'cancel-before-install',
          command: {
            operation: 'export-create',
            sessionId: 'session-1',
            format: 'jsonl',
            destinationPath: path.join(temporaryRoot, 'cancel-before-install.jsonl'),
          },
          now: 1,
        })
        const operationId = created.operation.exportOperationId
        yield* repository.claimExecution(operationId, 2)
        if (!repository.persistArtifactPreparation || !repository.beginArtifactInstallation) {
          return yield* Effect.die('durable artifact installation unavailable')
        }
        yield* repository.persistArtifactPreparation(
          operationId,
          { sha256: 'digest', sizeBytes: 10 },
          3,
        )
        yield* repository.requestCancellation({
          sessionId: 'session-1',
          exportOperationId: operationId,
          now: 4,
        })
        const claimed = yield* repository.beginArtifactInstallation(operationId, 5)
        yield* repository.complete(
          operationId,
          { recordsWritten: 1, resourcesWritten: 0, bytesWritten: 10 },
          6,
        )
        const after = yield* repository.read('session-1', operationId)
        return { claimed, after }
      }),
    )

    expect(result.claimed).toBe(false)
    expect(result.after?.status).toBe('cancelling')
  })
})
