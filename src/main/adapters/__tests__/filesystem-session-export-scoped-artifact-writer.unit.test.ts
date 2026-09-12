import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionExportManifest } from '@shared/types/session-export'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionExportArtifactWriter } from '../../ports/session-export-artifact-writer'
import type { SessionExportOperationRecord } from '../../ports/session-export-operation-repository'
import { FilesystemSessionExportArtifactWriterLive } from '../filesystem-session-export-artifact-writer'
import { scopedExportWorkingRoot } from '../filesystem-session-export-working-paths'

const manifest: SessionExportManifest = {
  schemaVersion: 1,
  sessionId: 'session-1',
  title: 'Scoped export',
  branchScope: 'tree',
  activeBranchId: 'branch-1',
  selectedBranchId: null,
  snapshot: { nodeHighWaterMark: 1, stateRevision: 2, queueRevision: 3, capturedAt: 4 },
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

function scopedOperation(input: {
  readonly destinationPath: string
  readonly destinationRoot: string
}): SessionExportOperationRecord {
  return {
    exportOperationId: 'export-scoped-swap',
    callerId: 'caller-1',
    sessionId: 'session-1',
    idempotencyKey: 'key-scoped-swap',
    format: 'jsonl',
    destinationPath: input.destinationPath,
    temporaryPath: `${input.destinationPath}.temporary`,
    destinationRoot: input.destinationRoot,
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
}

describe('scoped filesystem Session export artifact writer', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-scoped-export-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('rejects an ancestor swap without creating workspace-adjacent staging', async () => {
    if (process.platform === 'win32') return
    const lexicalWorkspace = path.join(temporaryRoot, 'workspace')
    await fs.mkdir(lexicalWorkspace)
    const workspace = await fs.realpath(lexicalWorkspace)
    const destinationDirectory = path.join(workspace, 'exports')
    const movedDirectory = path.join(workspace, 'exports-authorized')
    const outsideDirectory = path.join(temporaryRoot, 'outside')
    await Promise.all([fs.mkdir(destinationDirectory), fs.mkdir(outsideDirectory)])
    const destinationPath = path.join(destinationDirectory, 'session.jsonl')
    const exportOperation = scopedOperation({ destinationPath, destinationRoot: workspace })

    await expect(
      Effect.runPromise(
        Effect.gen(function* () {
          const writer = yield* SessionExportArtifactWriter
          const sink = yield* writer.open(exportOperation)
          yield* Effect.promise(() =>
            expect(fs.stat(exportOperation.temporaryPath)).rejects.toMatchObject({
              code: 'ENOENT',
            }),
          )
          yield* sink.writeManifest(manifest)
          yield* Effect.promise(async () => {
            await fs.rename(destinationDirectory, movedDirectory)
            await fs.symlink(outsideDirectory, destinationDirectory)
          })
          yield* sink.finalize()
        }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
      ),
    ).rejects.toThrow('outside the granted filesystem scope')
    await expect(fs.stat(path.join(outsideDirectory, 'session.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(
      fs.stat(path.join(outsideDirectory, 'session.jsonl.temporary')),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ignores a hostile legacy staging symlink and writes only through open descriptors', async () => {
    if (process.platform === 'win32') return
    const workspace = path.join(temporaryRoot, 'workspace-safe')
    const outside = path.join(temporaryRoot, 'outside-staging')
    await Promise.all([fs.mkdir(workspace), fs.mkdir(outside)])
    const canonicalWorkspace = await fs.realpath(workspace)
    const operation = scopedOperation({
      destinationPath: path.join(canonicalWorkspace, 'session.jsonl'),
      destinationRoot: canonicalWorkspace,
    })
    const legacyWorkingRoot = scopedExportWorkingRoot(operation)
    await fs.mkdir(path.dirname(legacyWorkingRoot), { recursive: true })
    await fs.rm(legacyWorkingRoot, { recursive: true, force: true })
    await fs.symlink(outside, legacyWorkingRoot)

    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* SessionExportArtifactWriter
        const sink = yield* writer.open(operation)
        yield* sink.writeManifest(manifest)
        yield* sink.finalize()
      }).pipe(Effect.provide(FilesystemSessionExportArtifactWriterLive)),
    )

    await expect(fs.readdir(outside)).resolves.toEqual([])
    await expect(fs.readFile(operation.destinationPath, 'utf8')).resolves.toContain('Scoped export')
  })
})
