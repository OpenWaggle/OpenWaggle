import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionFlatVectorIndex } from '../session-flat-vector-index'
import { SessionSemanticIndexSnapshotCache } from '../session-semantic-index-snapshot-cache'

describe('Session semantic snapshot cancellation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps an interrupted exact scan inside the snapshot concurrency bound until it stops', async () => {
    const cache = new SessionSemanticIndexSnapshotCache()
    const records = Array.from({ length: 10_000 }, (_, itemIndex) => ({
      sessionId: `session-${itemIndex}`,
      vector: new Float32Array([itemIndex + 1, 10_000 - itemIndex]),
    }))
    const allowedSessionIds = new Set(records.map((record) => record.sessionId))
    const has = allowedSessionIds.has.bind(allowedSessionIds)
    let inspectedRecords = 0
    let interruptFirst = () => undefined
    vi.spyOn(allowedSessionIds, 'has').mockImplementation((sessionId) => {
      inspectedRecords += 1
      if (inspectedRecords === 2_050) interruptFirst()
      return has(sessionId)
    })
    const originalSearch = SessionFlatVectorIndex.prototype.searchCooperatively
    let activeScans = 0
    let maximumActiveScans = 0
    let scanCalls = 0
    const firstScanSettled = Promise.withResolvers<void>()
    vi.spyOn(SessionFlatVectorIndex.prototype, 'searchCooperatively').mockImplementation(
      async function (
        this: SessionFlatVectorIndex,
        input: Parameters<SessionFlatVectorIndex['searchCooperatively']>[0],
      ) {
        scanCalls += 1
        const call = scanCalls
        activeScans += 1
        maximumActiveScans = Math.max(maximumActiveScans, activeScans)
        try {
          return await originalSearch.call(this, input)
        } finally {
          activeScans -= 1
          if (call === 1) firstScanSettled.resolve()
        }
      },
    )

    const firstFiber = Effect.runFork(
      cache.search({
        minimumRevision: 1,
        refresh: () =>
          Effect.succeed({
            revision: 1,
            rebuild: true,
            records,
            deletedSessionIds: [],
          }),
        query: new Float32Array([1, 0]),
        limit: 1,
        allowedSessionIds,
      }),
    )
    let interruption: Promise<unknown> | undefined
    interruptFirst = () => {
      interruption = Effect.runPromise(Fiber.interrupt(firstFiber))
    }
    const replacement = Effect.runPromise(
      cache.search({
        minimumRevision: 1,
        refresh: () => Effect.die(new Error('The loaded revision should be reused.')),
        query: new Float32Array([1, 0]),
        limit: 1,
        allowedSessionIds: new Set(['session-0']),
      }),
    )

    await replacement
    await firstScanSettled.promise
    await interruption

    expect(inspectedRecords).toBe(4_095)
    expect(maximumActiveScans).toBe(1)
  })
})
