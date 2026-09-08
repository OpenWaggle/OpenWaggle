import { fromPartial } from '@total-typescript/shoehorn'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { SessionExportArtifactError, SessionExportOperationRepositoryError } from '../../errors'
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
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import {
  continueSessionExportRecovery,
  recoverSessionExportsAfterHostLoss,
  runSessionExportRecoveryBackground,
} from '../session-export-recovery'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'
import { exportRepository } from './session-export-operation-service.test-support'

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
    Layer.succeed(SessionExportLiveAuthority, fromPartial({})),
  )
}

describe('durable Session export recovery', () => {
  it('only fences the queue during startup without enumerating or touching artifacts', async () => {
    const order: string[] = []
    const repository = fromPartial<SessionExportOperationRepositoryShape>({
      beginRecovery: Effect.sync(() => {
        order.push('fenced')
      }),
      recoverAfterHostLoss: () =>
        Effect.sync(() => {
          order.push('enumerated')
          return []
        }),
      claimNextExecution: () =>
        Effect.sync(() => {
          order.push('queue-drained')
          return { status: 'not-claimable' as const }
        }),
    })
    await Effect.runPromise(
      recoverSessionExportsAfterHostLoss().pipe(
        Effect.provide(recoveryLayer(repository, fromPartial({}))),
      ),
    )

    expect(order).toEqual(['fenced'])
  })

  it('completes a verified installed artifact instead of re-exporting it', async () => {
    const completed = vi.fn(() => Effect.void)
    const cleanupCompleted = vi.fn(() => Effect.void)
    const discard = vi.fn(() => Effect.void)
    const recovered = {
      ...operation,
      artifactReceipt: { sha256: 'installed-digest', sizeBytes: 20 },
    }
    let pending = true
    const repository = exportRepository({
      recoveryPending: Effect.sync(() => pending),
      completeRecoveryPage: Effect.sync(() => {
        pending = false
      }),
      recoverAfterHostLoss: () => Effect.succeed([recovered]),
      read: () => Effect.succeed(recovered),
      claimNextExecution: () => Effect.succeed({ status: 'not-claimable' as const }),
      complete: completed,
      completeCleanup: cleanupCompleted,
    })
    const artifacts = fromPartial<SessionExportArtifactWriterShape>({
      verifyInstalled: () => Effect.succeed(true),
      discard,
    })

    await Effect.runPromise(
      continueSessionExportRecovery().pipe(Effect.provide(recoveryLayer(repository, artifacts))),
    )

    expect(completed).toHaveBeenCalledWith(
      recovered.exportOperationId,
      recovered.progress,
      expect.any(Number),
      { cleanupPending: true },
    )
    expect(discard).toHaveBeenCalledOnce()
    expect(cleanupCompleted).toHaveBeenCalledWith(recovered.exportOperationId, expect.any(Number))
  })

  it('continues past empty and failed-cleanup pages before releasing queue admission', async () => {
    const pendingCleanup = { ...operation, status: 'cancelled' as const, cleanupPending: true }
    const pages = [[], [pendingCleanup], [{ ...operation, exportOperationId: 'last-export' }]]
    let pageIndex = 0
    const order: string[] = []
    const repository = exportRepository({
      recoveryPending: Effect.sync(() => pageIndex < pages.length),
      recoverAfterHostLoss: () => Effect.succeed(pages[pageIndex] ?? []),
      completeRecoveryPage: Effect.sync(() => {
        order.push(`settled-${pageIndex}`)
        pageIndex += 1
      }),
      claimNextExecution: () =>
        Effect.sync(() => {
          order.push('drained')
          return { status: 'not-claimable' as const }
        }),
    })
    const artifacts = fromPartial<SessionExportArtifactWriterShape>({
      discard: (candidate: SessionExportOperationRecord) =>
        candidate.cleanupPending
          ? Effect.fail(new SessionExportArtifactError({ operation: 'discard', message: 'denied' }))
          : Effect.void,
    })

    await Effect.runPromise(
      continueSessionExportRecovery().pipe(Effect.provide(recoveryLayer(repository, artifacts))),
    )

    expect(order).toEqual(['settled-0', 'settled-1', 'settled-2', 'drained'])
  })

  it('keeps cancellation terminal when it races installed-artifact verification', async () => {
    let cancelled = false
    const complete = vi.fn(() => Effect.void)
    const discard = vi.fn(() => Effect.void)
    const recovered = { ...operation, artifactReceipt: { sha256: 'digest', sizeBytes: 20 } }
    let pending = true
    const repository = exportRepository({
      recoveryPending: Effect.sync(() => pending),
      completeRecoveryPage: Effect.sync(() => {
        pending = false
      }),
      recoverAfterHostLoss: () => Effect.succeed([recovered]),
      read: () =>
        Effect.succeed(
          cancelled
            ? { ...recovered, status: 'cancelled', cancelRequested: true, cleanupPending: true }
            : recovered,
        ),
      complete,
    })
    const artifacts = fromPartial<SessionExportArtifactWriterShape>({
      verifyInstalled: () =>
        Effect.sync(() => {
          cancelled = true
          return true
        }),
      discard,
    })

    await Effect.runPromise(
      continueSessionExportRecovery().pipe(Effect.provide(recoveryLayer(repository, artifacts))),
    )

    expect(complete).not.toHaveBeenCalled()
    expect(discard).toHaveBeenCalledOnce()
  })

  it('does not acknowledge or drain a page after failed durable quarantine', async () => {
    const completeRecoveryPage = vi.fn(() => undefined)
    const claimNextExecution = vi.fn(() => Effect.succeed({ status: 'not-claimable' as const }))
    const repository = exportRepository({
      recoveryPending: Effect.succeed(true),
      recoverAfterHostLoss: () => Effect.succeed([operation]),
      completeRecoveryPage: Effect.sync(completeRecoveryPage),
      claimNextExecution,
      fail: () => Effect.fail(new SessionExportOperationRepositoryError({ operation: 'fail' })),
    })
    const artifacts = fromPartial<SessionExportArtifactWriterShape>({
      discard: () =>
        Effect.fail(new SessionExportArtifactError({ operation: 'discard', message: 'denied' })),
    })

    const result = await Effect.runPromise(
      continueSessionExportRecovery().pipe(
        Effect.provide(recoveryLayer(repository, artifacts)),
        Effect.either,
      ),
    )

    expect(result._tag).toBe('Left')
    expect(completeRecoveryPage).not.toHaveBeenCalled()
    expect(claimNextExecution).not.toHaveBeenCalled()
  })

  it('interrupts scoped recovery without acknowledging cleanup or starting queued work', async () => {
    const started = await Effect.runPromise(Deferred.make<void>())
    const cleanupCompleted = vi.fn(() => Effect.void)
    const pageCompleted = vi.fn(() => undefined)
    const claimNextExecution = vi.fn(() => Effect.succeed({ status: 'not-claimable' as const }))
    const repository = exportRepository({
      recoveryPending: Effect.succeed(true),
      recoverAfterHostLoss: () =>
        Effect.succeed([{ ...operation, status: 'cancelled', cleanupPending: true }]),
      completeRecoveryPage: Effect.sync(pageCompleted),
      completeCleanup: cleanupCompleted,
      claimNextExecution,
    })
    const artifacts = fromPartial<SessionExportArtifactWriterShape>({
      discard: () => Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never)),
    })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* runSessionExportRecoveryBackground
          yield* Deferred.await(started)
          yield* Fiber.interrupt(fiber)
        }),
      ).pipe(Effect.provide(recoveryLayer(repository, artifacts))),
    )

    expect(cleanupCompleted).not.toHaveBeenCalled()
    expect(pageCompleted).not.toHaveBeenCalled()
    expect(claimNextExecution).not.toHaveBeenCalled()
  })

  it('retries a failed repository page within the scoped worker', async () => {
    let pending = true
    const recover = vi
      .fn()
      .mockReturnValueOnce(
        Effect.fail(new SessionExportOperationRepositoryError({ operation: 'read-page' })),
      )
      .mockReturnValue(Effect.succeed([operation]))
    const discard = vi.fn(() => Effect.void)
    const repository = exportRepository({
      recoveryPending: Effect.sync(() => pending),
      completeRecoveryPage: Effect.sync(() => {
        pending = false
      }),
      recoverAfterHostLoss: recover,
    })
    const artifacts = fromPartial<SessionExportArtifactWriterShape>({ discard })

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* runSessionExportRecoveryBackground
          yield* Fiber.join(fiber)
        }),
      ).pipe(Effect.provide(recoveryLayer(repository, artifacts))),
    )

    expect(recover).toHaveBeenCalledTimes(2)
    expect(discard).toHaveBeenCalledOnce()
    expect(pending).toBe(false)
  })

  it('releases the recovery lease when the host starts draining during a retry', async () => {
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    const eventHub = new SessionHostEventHub()
    const releaseRuntime = installSessionHostEventRuntime({ eventHub, liveness })
    const recover = vi.fn(() =>
      Effect.sync(() => liveness.requestDrain()).pipe(
        Effect.zipRight(
          Effect.fail(new SessionExportOperationRepositoryError({ operation: 'read-page' })),
        ),
      ),
    )
    const repository = exportRepository({
      recoveryPending: Effect.succeed(true),
      recoverAfterHostLoss: recover,
    })

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fiber = yield* runSessionExportRecoveryBackground
            yield* Fiber.join(fiber)
          }),
        ).pipe(Effect.provide(recoveryLayer(repository, fromPartial({})))),
      )

      expect(recover).toHaveBeenCalledOnce()
      expect(liveness.ownerCount('export')).toBe(0)
      expect(requestShutdown).toHaveBeenCalledOnce()
    } finally {
      releaseRuntime()
      eventHub.close()
      liveness.close()
    }
  })
})
