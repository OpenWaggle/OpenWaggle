import { describe, expect, it } from 'vitest'
import {
  decodeFloat32Vector,
  encodeFloat32Vector,
  SessionFlatVectorIndex,
} from '../session-flat-vector-index'

describe('Session flat vector index', () => {
  it('ranks exact cosine matches deterministically and applies authorization before limiting', () => {
    const index = new SessionFlatVectorIndex()
    index.replace([
      { sessionId: 'b', vector: new Float32Array([1, 0]) },
      { sessionId: 'a', vector: new Float32Array([1, 0]) },
      { sessionId: 'c', vector: new Float32Array([0, 1]) },
    ])

    expect(index.search(new Float32Array([1, 0]), 2)).toEqual([
      { sessionId: 'a', similarity: 1 },
      { sessionId: 'b', similarity: 1 },
    ])
    expect(index.search(new Float32Array([1, 0]), 2, new Set(['c']))).toEqual([
      { sessionId: 'c', similarity: 0 },
    ])
  })

  it('round-trips vectors through the SQLite BLOB representation', () => {
    const vector = new Float32Array([0.25, -0.5, 1])
    expect([...decodeFloat32Vector(encodeFloat32Vector(vector), 3)]).toEqual([...vector])
  })

  it('reconciles records removed from the durable projection', () => {
    const index = new SessionFlatVectorIndex()
    index.upsert({ sessionId: 'keep', vector: new Float32Array([1, 0]) })
    index.upsert({ sessionId: 'deleted', vector: new Float32Array([0, 1]) })

    index.retainOnly(new Set(['keep']))

    expect(index.size).toBe(1)
    expect(index.search(new Float32Array([0, 1]), 2).map((match) => match.sessionId)).toEqual([
      'keep',
    ])
  })

  it('retains only the best bounded matches while scanning the authorized corpus', () => {
    const index = new SessionFlatVectorIndex()
    index.replace(
      Array.from({ length: 100 }, (_, itemIndex) => ({
        sessionId: `session-${String(itemIndex).padStart(3, '0')}`,
        vector: new Float32Array([itemIndex, 100 - itemIndex]),
      })),
    )

    expect(index.search(new Float32Array([1, 0]), 3).map((match) => match.sessionId)).toEqual([
      'session-099',
      'session-098',
      'session-097',
    ])
    expect(index.search(new Float32Array([1, 0]), 0)).toEqual([])
  })

  it('groups transcript chunks by their authorized Session before applying the result limit', () => {
    const index = new SessionFlatVectorIndex()
    index.replace([
      { sessionId: 'node-a1', groupId: 'session-a', vector: new Float32Array([1, 0]) },
      { sessionId: 'node-a2', groupId: 'session-a', vector: new Float32Array([0.9, 0.1]) },
      { sessionId: 'node-b1', groupId: 'session-b', vector: new Float32Array([0.8, 0.2]) },
      { sessionId: 'node-c1', groupId: 'session-c', vector: new Float32Array([0, 1]) },
    ])

    expect(
      index.searchGrouped(new Float32Array([1, 0]), 2, new Set(['session-a', 'session-b'])),
    ).toEqual([
      { sessionId: 'session-a', similarity: 1, matchedRecordId: 'node-a1' },
      {
        sessionId: 'session-b',
        similarity: expect.any(Number),
        matchedRecordId: 'node-b1',
      },
    ])
  })

  it('keeps concurrent worst-case bounded scans deterministic at the 50k node cap', async () => {
    const index = new SessionFlatVectorIndex()
    index.replace(
      Array.from({ length: 50_000 }, (_, itemIndex) => ({
        sessionId: `node-${String(itemIndex).padStart(5, '0')}`,
        groupId: `session-${String(itemIndex % 1_000).padStart(4, '0')}`,
        vector: new Float32Array([itemIndex + 1, 50_000 - itemIndex]),
      })),
    )
    const allowed = new Set(
      Array.from({ length: 1_000 }, (_, index) => `session-${String(index).padStart(4, '0')}`),
    )

    const results = await Promise.all(
      Array.from({ length: 8 }, async () =>
        index.searchGrouped(new Float32Array([1, 0]), 5, allowed),
      ),
    )

    expect(index.size).toBe(50_000)
    expect(results.every((result) => result.length === 5)).toBe(true)
    expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(
      true,
    )
  })
})
