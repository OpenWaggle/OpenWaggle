import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionExportArtifactError } from '../../errors'
import type { SessionExportArtifactWriterShape } from '../../ports/session-export-artifact-writer'
import { installSessionHostEventRuntime } from '../../session-host/session-host-events'
import { runSessionExportOperation } from '../session-export-operation-service'
import { recoverSessionExportsAfterHostLoss } from '../session-export-recovery'
import { forkSupervisedSessionExport } from '../session-export-supervision'
import { SessionHostEventHub } from '../session-host-event-hub'
import { SessionHostLiveness } from '../session-host-liveness'
import {
  exportOperation as operation,
  exportRepository as repository,
  exportTestLayer as testLayer,
} from './session-export-operation-service.test-support'
import { verifyProfileCapabilityReductionStopsExport } from './session-export-profile-authority.test-support'
import { verifyRevokedWorkspaceRootStopsExport } from './session-export-resource-authority.test-support'

describe('Session export operation service', () => {
  const runtimeReleases: Array<() => void> = []
  const livenessInstances: SessionHostLiveness[] = []

  afterEach(() => {
    for (const release of runtimeReleases.splice(0)) release()
    for (const liveness of livenessInstances.splice(0)) liveness.close()
  })

  it('durably fails an export when artifact opening fails, then attempts operation cleanup', async () => {
    const order: string[] = []
    const fail = vi.fn(() =>
      Effect.sync(() => {
        order.push('failed')
      }),
    )
    const discard = vi.fn(() =>
      Effect.sync(() => {
        order.push('discarded')
      }),
    )
    const operations = repository({ fail })
    const artifacts: SessionExportArtifactWriterShape = {
      open: () =>
        Effect.fail(new SessionExportArtifactError({ operation: 'open', message: 'open failed' })),
      discard,
    }

    await Effect.runPromise(
      runSessionExportOperation(operation.exportOperationId, { release: vi.fn() }).pipe(
        Effect.provide(testLayer(operations, artifacts)),
      ),
    )

    expect(fail).toHaveBeenCalledOnce()
    expect(discard).toHaveBeenCalledOnce()
    expect(order).toEqual(['failed', 'discarded'])
  })

  it('keeps the durable terminal transition when best-effort sink cleanup defects', async () => {
    const order: string[] = []
    const fail = vi.fn(() =>
      Effect.sync(() => {
        order.push('failed')
      }),
    )
    const sinkDiscard = vi.fn(() =>
      Effect.sync(() => {
        order.push('discarded')
        throw new Error('discard defect')
      }),
    )
    const operations = repository({ fail })
    const artifacts: SessionExportArtifactWriterShape = {
      open: () =>
        Effect.succeed({
          writeManifest: () =>
            Effect.fail(
              new SessionExportArtifactError({
                operation: 'write-manifest',
                message: 'write failed',
              }),
            ),
          writeRecords: () => Effect.succeed(0),
          writeResource: () => Effect.succeed(0),
          finalize: () => Effect.void,
          discard: sinkDiscard,
        }),
      discard: () => Effect.void,
    }

    await Effect.runPromise(
      runSessionExportOperation(operation.exportOperationId, { release: vi.fn() }).pipe(
        Effect.provide(testLayer(operations, artifacts)),
      ),
    )

    expect(fail).toHaveBeenCalledOnce()
    expect(sinkDiscard).toHaveBeenCalledOnce()
    expect(order).toEqual(['failed', 'discarded'])
  })

  it('persists an artifact receipt before installation and completes only after installation', async () => {
    const order: string[] = []
    const operations = repository({
      persistArtifactPreparation: () =>
        Effect.sync(() => {
          order.push('receipt-persisted')
        }),
      beginArtifactInstallation: () =>
        Effect.sync(() => {
          order.push('install-claimed')
          return true
        }),
      complete: () =>
        Effect.sync(() => {
          order.push('completed')
        }),
    })
    const artifacts: SessionExportArtifactWriterShape = {
      open: () =>
        Effect.succeed({
          writeManifest: () => Effect.succeed(0),
          writeRecords: () => Effect.succeed(0),
          writeResource: () => Effect.succeed(0),
          prepareFinalization: () =>
            Effect.sync(() => {
              order.push('prepared')
              return { sha256: 'artifact-digest', sizeBytes: 10 }
            }),
          finalize: () =>
            Effect.sync(() => {
              order.push('installed')
            }),
          discard: () => Effect.void,
        }),
      discard: () => Effect.void,
    }

    await Effect.runPromise(
      runSessionExportOperation(operation.exportOperationId, { release: vi.fn() }).pipe(
        Effect.provide(testLayer(operations, artifacts)),
      ),
    )

    expect(order).toEqual([
      'prepared',
      'receipt-persisted',
      'install-claimed',
      'installed',
      'completed',
    ])
  })

  it('stops a profile export when required capabilities are reduced between pages', async () => {
    await verifyProfileCapabilityReductionStopsExport()
  })

  it('stops before reading a bundled resource when its live workspace export root is revoked', async () => {
    await verifyRevokedWorkspaceRootStopsExport()
  })

  it('drains the Host when an unsatisfied durable export failure escapes its worker', async () => {
    const requestShutdown = vi.fn()
    const liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown })
    const release = installSessionHostEventRuntime({
      eventHub: new SessionHostEventHub(),
      liveness,
    })
    runtimeReleases.push(release)
    livenessInstances.push(liveness)

    await Effect.runPromise(
      forkSupervisedSessionExport({ operation, effect: Effect.die('repository unavailable') }),
    )

    await vi.waitFor(() => expect(requestShutdown).toHaveBeenCalledOnce())
    expect(liveness.isDraining()).toBe(true)
  })

  it('quarantines one stale artifact cleanup failure without blocking later export recovery', async () => {
    const broken = { ...operation, exportOperationId: 'export-broken', status: 'queued' as const }
    const healthy = { ...operation, exportOperationId: 'export-healthy', status: 'queued' as const }
    const fail = vi.fn(() => Effect.void)
    const claimExecution = vi.fn((operationId: string) =>
      Effect.succeed({
        status: 'claimed' as const,
        operation: operationId === healthy.exportOperationId ? healthy : broken,
      }),
    )
    const operations = repository({
      recoverAfterHostLoss: () => Effect.succeed([broken, healthy]),
      claimExecution,
      fail,
    })
    const artifacts: SessionExportArtifactWriterShape = {
      discard: (candidate) =>
        candidate.exportOperationId === broken.exportOperationId
          ? Effect.fail(
              new SessionExportArtifactError({
                operation: 'discard',
                message: 'permission denied',
              }),
            )
          : Effect.void,
      open: () =>
        Effect.succeed({
          writeManifest: () => Effect.succeed(0),
          writeRecords: () => Effect.succeed(0),
          writeResource: () => Effect.succeed(0),
          finalize: () => Effect.void,
          discard: () => Effect.void,
        }),
    }

    await Effect.runPromise(
      recoverSessionExportsAfterHostLoss().pipe(Effect.provide(testLayer(operations, artifacts))),
    )

    expect(fail).toHaveBeenCalledWith(
      broken.exportOperationId,
      expect.objectContaining({ code: 'export_recovery_cleanup_failed' }),
      expect.any(Number),
    )
    await vi.waitFor(() =>
      expect(claimExecution).toHaveBeenCalledWith(healthy.exportOperationId, expect.any(Number)),
    )
  })
})
