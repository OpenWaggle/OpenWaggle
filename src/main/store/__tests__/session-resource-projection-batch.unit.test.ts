import { describe, expect, it } from 'vitest'
import {
  RESOURCE_PROJECTION_MAX_SERIALIZED_BYTES,
  selectSessionResourceProjectionBatch,
} from '../sessions/session-resource-projection'

const MEBIBYTE = 1024 * 1024

function candidate(index: number, payloadBytes = 25 * MEBIBYTE) {
  return {
    id: `node-${String(index)}`,
    created_order: index,
    payload_bytes: payloadBytes,
  }
}

describe('session resource projection batching', () => {
  it('bounds hydrated node payload bytes even when a page has 64 large rows', () => {
    const candidates = Array.from({ length: 64 }, (_, index) => candidate(index))

    const selection = selectSessionResourceProjectionBatch(candidates, 64)

    expect(selection.ids.length).toBeGreaterThan(0)
    expect(selection.ids.length).toBeLessThan(64)
    expect(selection.serializedBytes).toBeLessThanOrEqual(RESOURCE_PROJECTION_MAX_SERIALIZED_BYTES)
    expect(selection.throughCreatedOrder).toBe(selection.ids.length - 1)
    expect(selection.hasMore).toBe(true)
  })

  it('advances past one individually oversized node without hydrating it', () => {
    const oversized = candidate(7, RESOURCE_PROJECTION_MAX_SERIALIZED_BYTES + 1)

    const selection = selectSessionResourceProjectionBatch([oversized], 64)

    expect(selection).toEqual({
      ids: [],
      serializedBytes: 0,
      throughCreatedOrder: 7,
      hasMore: false,
    })
  })
})
