import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import type { SessionExportArtifactWriterShape } from '../../ports/session-export-artifact-writer'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { runSessionExportOperation } from '../session-export-operation-service'
import {
  exportManifest,
  exportOperation,
  exportRepository,
  exportTestDependencies,
} from './session-export-operation-service.test-support'

describe('Session export page cancellation', () => {
  it('observes cancellation between bounded pages without reading a third page', async () => {
    let cancellationChecks = 0
    let queryCount = 0
    const cancel = vi.fn(() => Effect.void)
    const writeRecords = vi.fn(() => Effect.succeed(0))
    const operations = exportRepository({
      cancellationRequested: () =>
        Effect.sync(() => {
          cancellationChecks += 1
          return cancellationChecks >= 3
        }),
      cancel,
    })
    const artifacts: SessionExportArtifactWriterShape = {
      open: () =>
        Effect.succeed({
          writeManifest: () => Effect.succeed(0),
          writeRecords,
          writeResource: () => Effect.succeed(0),
          finalize: () => Effect.void,
          discard: () => Effect.void,
        }),
      discard: () => Effect.void,
    }
    const queries = Layer.succeed(SessionQueryRepository, {
      execute: ({ request }) =>
        Effect.sync(() => {
          queryCount += 1
          return {
            contractVersion: 2 as const,
            requestId: request.requestId,
            outcome: {
              operation: 'export' as const,
              manifest: exportManifest,
              records: [],
              nextCreatedOrder: queryCount,
            },
          }
        }),
    })

    await Effect.runPromise(
      runSessionExportOperation(exportOperation.exportOperationId, { release: vi.fn() }).pipe(
        Effect.provide(exportTestDependencies(operations, artifacts, queries)),
      ),
    )

    expect(queryCount).toBe(2)
    expect(writeRecords).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })
})
