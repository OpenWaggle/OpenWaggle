import { spawnSync } from 'node:child_process'
import { constants as FS_CONSTANTS } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { openFilesystemSessionExportResource } from '../../adapters/filesystem-session-export-resource-resolver'
import { SessionExportArtifactError } from '../../errors'
import type { SessionExportArtifactWriterShape } from '../../ports/session-export-artifact-writer'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { cancelSessionExport } from '../session-export-cancellation'
import { runSessionExportOperation } from '../session-export-operation-service'
import {
  exportTestDependencies,
  exportOperation as operation,
  exportRepository as repository,
  exportTestLayer as testLayer,
} from './session-export-operation-service.test-support'

describe('Session export cancellation', () => {
  it('aborts active artifact preparation when cancellation is requested', async () => {
    let cancellationRequested = false
    let preparationSignal: AbortSignal | undefined
    let preparationStartedResolve: (() => void) | undefined
    const preparationStarted = new Promise<void>((resolve) => {
      preparationStartedResolve = resolve
    })
    const cancel = vi.fn(() => Effect.void)
    const fail = vi.fn(() => Effect.void)
    const operations = repository({
      requestCancellation: () =>
        Effect.sync(() => {
          cancellationRequested = true
          return {
            replayed: false,
            operation: {
              ...operation,
              status: 'cancelling' as const,
              cancelRequested: true,
            },
          }
        }),
      cancellationRequested: () => Effect.succeed(cancellationRequested),
      persistArtifactPreparation: () => Effect.void,
      beginArtifactInstallation: () => Effect.succeed(true),
      cancel,
      fail,
    })
    const artifacts: SessionExportArtifactWriterShape = {
      open: () =>
        Effect.succeed({
          writeManifest: () => Effect.succeed(0),
          writeRecords: () => Effect.succeed(0),
          writeResource: () => Effect.succeed(0),
          prepareFinalization: () =>
            Effect.tryPromise({
              try: (signal) => {
                preparationSignal = signal
                preparationStartedResolve?.()
                return new Promise<never>((_resolve, reject) => {
                  signal.addEventListener('abort', () => reject(new Error('aborted')), {
                    once: true,
                  })
                })
              },
              catch: (cause) =>
                new SessionExportArtifactError({
                  operation: 'prepare-finalization',
                  message: cause instanceof Error ? cause.message : String(cause),
                }),
            }),
          finalize: () => Effect.void,
          discard: () => Effect.void,
        }),
      discard: () => Effect.void,
    }
    const layer = testLayer(operations, artifacts)
    const running = Effect.runPromise(
      runSessionExportOperation(operation.exportOperationId, { release: vi.fn() }).pipe(
        Effect.provide(layer),
      ),
    )
    await preparationStarted

    await Effect.runPromise(
      cancelSessionExport({
        request: {
          contractVersion: 2,
          requestId: 'cancel-active-export',
          idempotencyKey: 'cancel-active-export-once',
          command: {
            operation: 'export-cancel',
            sessionId: operation.sessionId,
            exportOperationId: operation.exportOperationId,
          },
        },
      }).pipe(Effect.provide(layer)),
    )
    await running

    expect(preparationSignal?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(fail).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')(
    'rejects a FIFO resource without stalling, then cancels and cleans the active export',
    async () => {
      const temporaryRoot = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-fifo-cancel-')),
      )
      const fifoPath = path.join(temporaryRoot, 'resource.pipe')
      expect(spawnSync('mkfifo', [fifoPath]).status).toBe(0)

      let cancellationRequested = false
      let reportFifoRejected: (() => void) | undefined
      let releaseResolver: (() => void) | undefined
      const fifoRejected = new Promise<void>((resolve) => {
        reportFifoRejected = resolve
      })
      const resolverRelease = new Promise<void>((resolve) => {
        releaseResolver = resolve
      })
      const cancel = vi.fn(() => Effect.void)
      const fail = vi.fn(() => Effect.void)
      const completeCleanup = vi.fn(() => Effect.void)
      const sinkDiscard = vi.fn(() => Effect.void)
      const exportWithFifo = {
        ...operation,
        format: 'bundle' as const,
        resourceSourceRoot: temporaryRoot,
        resources: [{ kind: 'workspace-file' as const, path: 'resource.pipe' }],
      }
      const operations = repository({
        claimExecution: () =>
          Effect.succeed({ status: 'claimed' as const, operation: exportWithFifo }),
        requestCancellation: () =>
          Effect.sync(() => {
            cancellationRequested = true
            return {
              replayed: false,
              operation: {
                ...exportWithFifo,
                status: 'cancelling' as const,
                cancelRequested: true,
              },
            }
          }),
        cancellationRequested: () => Effect.succeed(cancellationRequested),
        cancel,
        fail,
        completeCleanup,
      })
      const artifacts: SessionExportArtifactWriterShape = {
        open: () =>
          Effect.succeed({
            writeManifest: () => Effect.succeed(0),
            writeRecords: () => Effect.succeed(0),
            writeResource: () => Effect.die('FIFO resource must not reach the artifact writer'),
            finalize: () => Effect.void,
            discard: sinkDiscard,
          }),
        discard: () => Effect.void,
      }
      const resourceResolver = Effect.tryPromise({
        try: async () => {
          try {
            return await openFilesystemSessionExportResource({
              workspacePath: temporaryRoot,
              resourcePath: 'resource.pipe',
            })
          } catch (error) {
            reportFifoRejected?.()
            await resolverRelease
            throw error
          }
        },
        catch: (cause) =>
          new SessionExportArtifactError({
            operation: 'resolve-export-resource',
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      })
      const layer = Layer.merge(
        exportTestDependencies(
          operations,
          artifacts,
          undefined,
          Layer.succeed(SessionExportResourceResolver, { resolve: () => resourceResolver }),
        ),
        Layer.succeed(SqlClient.SqlClient, fromPartial({})),
      )
      let rescueWriter: Awaited<ReturnType<typeof fs.open>> | undefined
      try {
        const running = Effect.runPromise(
          runSessionExportOperation(operation.exportOperationId, { release: vi.fn() }).pipe(
            Effect.provide(layer),
          ),
        )
        const outcome = await Promise.race([
          fifoRejected.then(() => 'rejected' as const),
          new Promise<'stalled'>((resolve) => {
            setTimeout(() => resolve('stalled'), 500).unref()
          }),
        ])
        if (outcome === 'stalled') {
          rescueWriter = await fs.open(
            fifoPath,
            FS_CONSTANTS.O_RDWR | (FS_CONSTANTS.O_NONBLOCK ?? 0),
          )
        }
        expect(outcome).toBe('rejected')

        await Effect.runPromise(
          cancelSessionExport({
            request: {
              contractVersion: 2,
              requestId: 'cancel-fifo-export',
              idempotencyKey: 'cancel-fifo-export-once',
              command: {
                operation: 'export-cancel',
                sessionId: operation.sessionId,
                exportOperationId: operation.exportOperationId,
              },
            },
          }).pipe(Effect.provide(layer)),
        )
        releaseResolver?.()
        await running

        expect(cancel).toHaveBeenCalledOnce()
        expect(fail).not.toHaveBeenCalled()
        expect(sinkDiscard).toHaveBeenCalledOnce()
        expect(completeCleanup).toHaveBeenCalledOnce()
      } finally {
        releaseResolver?.()
        await rescueWriter?.close()
        await fs.rm(temporaryRoot, { recursive: true, force: true })
      }
    },
    5_000,
  )
})
