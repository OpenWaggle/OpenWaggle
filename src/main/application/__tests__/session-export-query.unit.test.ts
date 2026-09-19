import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { SessionQueryRepositoryShape } from '../../ports/session-query-repository'
import { readExportPage } from '../session-export-query'
import { exportManifest, exportOperation } from './session-export-operation-service.test-support'

describe('Session export page query', () => {
  it('binds every durable page to its export materialization operation', async () => {
    const execute = vi.fn<SessionQueryRepositoryShape['execute']>(({ request }) =>
      Effect.succeed({
        contractVersion: 2 as const,
        requestId: request.requestId,
        outcome: { operation: 'export' as const, manifest: exportManifest, records: [] },
      }),
    )

    await Effect.runPromise(readExportPage({ execute }, exportOperation, exportManifest, 12))

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        exportMaterializationOperationId: exportOperation.exportOperationId,
        request: expect.objectContaining({
          query: expect.objectContaining({
            afterCreatedOrder: 12,
            snapshotManifest: exportManifest,
          }),
        }),
      }),
    )
  })
})
