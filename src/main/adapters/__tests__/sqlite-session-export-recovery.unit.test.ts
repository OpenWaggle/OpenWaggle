import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recoverSessionExportsAfterHostLoss } from '../../application/session-export-recovery'
import { SessionExportArtifactError } from '../../errors'
import {
  SessionExportArtifactWriter,
  type SessionExportArtifactWriterShape,
} from '../../ports/session-export-artifact-writer'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import {
  makeSessionExportOperationRuntime,
  withSessionExportOperationRepository,
} from './sqlite-session-export-operation-test-layer'

describe('SQLite Session export recovery', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeSessionExportOperationRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-recovery-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps a verified recovered installation terminal when residual discard fails', async () => {
    const active = makeSessionExportOperationRuntime(path.join(temporaryRoot, 'exports.sqlite'))
    runtimes.push(active)
    const operationId = await withSessionExportOperationRepository(active, (repository) =>
      Effect.gen(function* () {
        const created = yield* repository.create({
          callerId: 'cli-1',
          idempotencyKey: 'recover-installed-discard-failure',
          command: {
            operation: 'export-create',
            sessionId: 'session-1',
            format: 'jsonl',
            destinationPath: path.join(temporaryRoot, 'installed-discard-failure.jsonl'),
          },
          now: 1,
        })
        yield* repository.claimExecution(created.operation.exportOperationId, 2)
        if (!repository.persistArtifactPreparation || !repository.beginArtifactInstallation) {
          return yield* Effect.die('durable artifact installation unavailable')
        }
        yield* repository.persistArtifactPreparation(
          created.operation.exportOperationId,
          { sha256: 'verified-installed-digest', sizeBytes: 30 },
          3,
        )
        yield* repository.beginArtifactInstallation(created.operation.exportOperationId, 4)
        return created.operation.exportOperationId
      }),
    )
    const verifyInstalled = vi.fn(() => Effect.succeed(true))
    const discard = vi.fn(() =>
      Effect.fail(
        new SessionExportArtifactError({
          operation: 'discard',
          message: 'simulated residual cleanup failure',
        }),
      ),
    )
    const artifacts = fromPartial<SessionExportArtifactWriterShape>({
      verifyInstalled,
      discard,
    })

    await active.runPromise(
      recoverSessionExportsAfterHostLoss().pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(SessionExportArtifactWriter, artifacts),
            Layer.succeed(SessionExportResourceResolver, fromPartial({})),
            Layer.succeed(SessionQueryRepository, fromPartial({})),
          ),
        ),
      ),
    )

    const result = await withSessionExportOperationRepository(active, (repository) =>
      Effect.gen(function* () {
        const completed = yield* repository.read('session-1', operationId)
        const nextClaim = yield* repository.claimNextExecution(6)
        const pendingCleanup = yield* repository.listPendingCleanup
        return { completed, nextClaim, pendingCleanup }
      }),
    )

    expect(verifyInstalled).toHaveBeenCalledOnce()
    expect(discard).toHaveBeenCalledOnce()
    expect(result.completed).toMatchObject({
      status: 'completed',
      cleanupPending: true,
      artifactReceipt: { sha256: 'verified-installed-digest', sizeBytes: 30 },
    })
    expect(result.nextClaim).toEqual({ status: 'not-claimable' })
    expect(result.pendingCleanup.map((operation) => operation.exportOperationId)).toContain(
      operationId,
    )
  })
})
