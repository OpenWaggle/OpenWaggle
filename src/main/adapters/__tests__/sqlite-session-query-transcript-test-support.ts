import type { SessionExportManifest } from '@shared/types/session-export'
import { SESSION_QUERY_MAX_RESPONSE_BYTES } from '@shared/types/session-query'
import { expect } from 'vitest'
import {
  executeSessionQuery as executeQuery,
  type makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

export async function collectLargeTranscriptPages(
  runtime: ReturnType<typeof makeRuntime>,
  operation: 'export' | 'items',
) {
  const seen = new Set<string>()
  let afterCreatedOrder: number | undefined
  let throughCreatedOrder: number | undefined
  let snapshotManifest: SessionExportManifest | undefined
  do {
    const pageCursor = {
      ...(afterCreatedOrder === undefined ? {} : { afterCreatedOrder }),
      ...(throughCreatedOrder === undefined ? {} : { throughCreatedOrder }),
    }
    const result = await executeQuery(
      runtime,
      operation === 'items'
        ? { operation, sessionId: 'worker', limit: 500, branchScope: 'tree', ...pageCursor }
        : {
            operation,
            sessionId: 'worker',
            limit: 500,
            branchScope: 'tree',
            ...pageCursor,
            ...(snapshotManifest ? { snapshotManifest } : {}),
          },
    )
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      SESSION_QUERY_MAX_RESPONSE_BYTES,
    )
    if (result.outcome.operation === 'items' && !('error' in result.outcome)) {
      for (const record of result.outcome.items) seen.add(record.nodeId)
      throughCreatedOrder ??= result.outcome.highWaterMark
      afterCreatedOrder = result.outcome.nextCreatedOrder
      continue
    }
    if (result.outcome.operation === 'export' && !('error' in result.outcome)) {
      for (const record of result.outcome.records) seen.add(record.nodeId)
      throughCreatedOrder ??= result.outcome.manifest.snapshot.nodeHighWaterMark
      snapshotManifest ??= result.outcome.manifest
      afterCreatedOrder = result.outcome.nextCreatedOrder
      continue
    }
    throw new Error(`Expected ${operation} page.`)
  } while (afterCreatedOrder !== undefined)
  return seen
}
