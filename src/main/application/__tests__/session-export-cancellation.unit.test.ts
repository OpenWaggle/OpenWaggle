import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { SessionExportArtifactError } from '../../errors'
import type { SessionExportArtifactWriterShape } from '../../ports/session-export-artifact-writer'
import { cancelSessionExport } from '../session-export-cancellation'
import { runSessionExportOperation } from '../session-export-operation-service'
import {
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
})
