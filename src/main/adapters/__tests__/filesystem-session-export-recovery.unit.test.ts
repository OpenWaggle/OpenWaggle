import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionExportManifest } from '@shared/types/session-export'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionExportArtifactWriter } from '../../ports/session-export-artifact-writer'
import type { SessionExportOperationRecord } from '../../ports/session-export-operation-repository'
import { FilesystemSessionExportArtifactWriterLive } from '../filesystem-session-export-artifact-writer'
import { scopedExportWorkingRoot } from '../filesystem-session-export-working-paths'

const manifest: SessionExportManifest = {
  schemaVersion: 1,
  sessionId: 'session-recovery',
  title: 'Recover export',
  branchScope: 'tree',
  activeBranchId: 'branch-1',
  selectedBranchId: null,
  snapshot: { nodeHighWaterMark: 0, stateRevision: 1, queueRevision: 0, capturedAt: 1 },
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

describe('filesystem Session export recovery', () => {
  let temporaryRoot = ''

  afterEach(async () => {
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('leaves no named scoped staging behind during Host-loss recovery', async () => {
    if (process.platform === 'win32') return
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-recovery-'))
    const workspace = path.join(temporaryRoot, 'workspace')
    await fs.mkdir(workspace)
    const authorizedWorkspace = await fs.realpath(workspace)
    const operation: SessionExportOperationRecord = {
      exportOperationId: `recovery-${path.basename(temporaryRoot)}`,
      callerId: 'caller-1',
      sessionId: 'session-recovery',
      idempotencyKey: 'recovery-key',
      format: 'bundle',
      destinationPath: path.join(authorizedWorkspace, 'recovered.zip'),
      temporaryPath: path.join(authorizedWorkspace, 'recovered.zip.temporary'),
      destinationRoot: authorizedWorkspace,
      overwriteExisting: false,
      status: 'running',
      cleanupPending: false,
      branchScope: 'tree',
      includeQueueBodies: false,
      resources: [],
      progress: { recordsWritten: 0, resourcesWritten: 0, bytesWritten: 0 },
      cancelRequested: false,
      createdAt: 1,
      updatedAt: 1,
    }
    const workingRoot = scopedExportWorkingRoot(operation)

    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const abandonedSink = yield* writer.open(operation)
        yield* abandonedSink.writeManifest(manifest)
        yield* Effect.promise(() =>
          expect(fs.stat(workingRoot)).rejects.toMatchObject({ code: 'ENOENT' }),
        )
        yield* writer.discard(operation)
        yield* Effect.promise(() =>
          expect(fs.stat(workingRoot)).rejects.toMatchObject({ code: 'ENOENT' }),
        )
        yield* abandonedSink.discard()
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )
  })

  it('verifies an artifact installed after its durable receipt was recorded', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-installed-'))
    const destinationPath = path.join(temporaryRoot, 'installed.jsonl')
    const operation: SessionExportOperationRecord = {
      exportOperationId: 'installed-export',
      callerId: 'caller-1',
      sessionId: 'session-recovery',
      idempotencyKey: 'installed-key',
      format: 'jsonl',
      destinationPath,
      temporaryPath: `${destinationPath}.temporary`,
      overwriteExisting: false,
      status: 'running',
      cleanupPending: false,
      branchScope: 'tree',
      includeQueueBodies: false,
      resources: [],
      progress: { recordsWritten: 0, resourcesWritten: 0, bytesWritten: 0 },
      cancelRequested: false,
      createdAt: 1,
      updatedAt: 1,
    }

    const verified = await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const sink = yield* writer.open(operation)
        yield* sink.writeManifest(manifest)
        if (!sink.prepareFinalization || !writer.verifyInstalled) {
          return yield* Effect.die('durable artifact verification unavailable')
        }
        const receipt = yield* sink.prepareFinalization()
        yield* sink.finalize()
        return yield* writer.verifyInstalled(operation, receipt)
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )

    expect(verified).toBe(true)
  })
})
