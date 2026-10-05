import { describe, expect, it } from 'vitest'
import { flushedKey } from '../buffer-entry'
import { FLUSH_LEASE_KEY } from '../flush-finish'
import { FLUSH_MANIFEST_KEY } from '../flush-manifest'
import {
  aggregatedRecords,
  bufferedKeys,
  bufferRequests,
  flush,
  type PublishedRecord,
  publishedCount,
  totalCount,
} from './flush-test-support'
import { bufferExpiry, MemoryKeyValueStore, YESTERDAY } from './test-support'

function uuidsOf(records: readonly PublishedRecord[]) {
  return records.map((record) => record.uuid).sort()
}

/**
 * A namespace where two flushes overlap for certain: a lease check waits until both have taken
 * the lease, as two calls running side by side would.
 */
class OverlappingStore extends MemoryKeyValueStore {
  private leases = 0
  private bothLeased: () => void = () => undefined
  private readonly overlap = new Promise<void>((resolve) => {
    this.bothLeased = resolve
  })

  override async put(key: string, value: string, options?: { readonly expirationTtl?: number }) {
    await super.put(key, value, options)
    if (key !== FLUSH_LEASE_KEY) return
    this.leases += 1
    if (this.leases === 2) this.bothLeased()
  }

  override async get(key: string) {
    if (key === FLUSH_LEASE_KEY) await this.overlap
    return super.get(key)
  }
}

/** A namespace where another flush always takes the lease over right after this one took it. */
class LeaseTakeoverStore extends MemoryKeyValueStore {
  override async put(key: string, value: string, options?: { readonly expirationTtl?: number }) {
    await super.put(key, key === FLUSH_LEASE_KEY ? 'another-flush' : value, options)
  }
}

describe('flush retiring', () => {
  it('deletes what it published and writes a tombstone only when a delete fails', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    const [stuck, ...others] = bufferedKeys(store)
    if (stuck === undefined) throw new Error('expected a buffered key')
    store.failingDeletes.add(stuck)

    expect((await flush(store)).body).toMatchObject({ processed: 5, undeleted: 1 })
    expect(store.entries.get(flushedKey(stuck))).toEqual({
      value: '1',
      options: { expiration: bufferExpiry(YESTERDAY) },
    })
    for (const key of others) expect(store.entries.has(flushedKey(key))).toBe(false)
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(false)

    store.failingDeletes.clear()
    await bufferRequests(store, 5)
    const next = await flush(store)
    expect(next.body).toMatchObject({ processed: 5, undeleted: 0 })
    expect(publishedCount(aggregatedRecords(next.requests), 'run.finished', '_count', '1')).toBe(5)
    expect(store.entries.has(stuck)).toBe(false)
  })

  it('keeps the manifest, and sends nothing new, until every entry is deleted or tombstoned', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 10)
    const [stuck] = bufferedKeys(store)
    if (stuck === undefined) throw new Error('expected a buffered key')
    store.failingDeletes.add(stuck)
    store.failingPuts.add(flushedKey(stuck))

    const first = await flush(store)
    expect(first.body).toMatchObject({ processed: 10, undeleted: 1 })
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(true)
    await bufferRequests(store, 5)
    const blocked = await flush(store)
    // The entry and the manifest it keeps alive are both left in KV.
    expect(blocked.body).toMatchObject({ processed: 0, undeleted: 2 })
    expect(blocked.requests).toEqual([])

    store.failingDeletes.clear()
    store.failingPuts.clear()
    const finished = await flush(store)
    const published = [first, finished].flatMap(({ requests }) => aggregatedRecords(requests))
    expect(totalCount(published, 'run.finished', '_count', '1')).toBe(15)
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(false)
    expect(bufferedKeys(store)).toEqual([])
  })

  it('never resends part of a set once some of its entries are gone', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    const stuck = bufferedKeys(store).slice(0, 3)
    for (const key of stuck) {
      store.failingDeletes.add(key)
      store.failingPuts.add(flushedKey(key))
    }
    expect((await flush(store)).body).toMatchObject({ processed: 5, undeleted: 3 })

    store.failingDeletes.clear()
    store.failingPuts.clear()
    const next = await flush(store)
    expect(next.requests).toEqual([])
    expect(next.body).toMatchObject({ processed: 0, undeleted: 0 })
    expect(bufferedKeys(store)).toEqual([])
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(false)
  })

  it('resends a set whose every entry is untouched under the same UUIDs', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    for (const key of bufferedKeys(store)) {
      store.failingDeletes.add(key)
      store.failingPuts.add(flushedKey(key))
    }

    const first = await flush(store)
    const second = await flush(store)
    expect(uuidsOf(aggregatedRecords(second.requests))).toEqual(
      uuidsOf(aggregatedRecords(first.requests)),
    )
  })
})

describe('flush lease', () => {
  it('publishes nothing when another flush took the lease over', async () => {
    const store = new LeaseTakeoverStore()
    await bufferRequests(store, 5)
    const { result, body, requests } = await flush(store)

    expect(result.response.status).toBe(409)
    expect(body).toEqual({ skipped: 'another flush took over' })
    expect(requests).toEqual([])
    expect(bufferedKeys(store)).toHaveLength(5)
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(false)
  })

  it('lets only one of two overlapping flushes publish', async () => {
    const store = new OverlappingStore()
    await bufferRequests(store, 6)

    const results = await Promise.all([flush(store), flush(store)])
    const statuses = results.map(({ result }) => result.response.status).sort()
    const published = results.flatMap(({ requests }) =>
      requests.length === 0 ? [] : aggregatedRecords(requests),
    )

    expect(statuses).toEqual([200, 409])
    expect(totalCount(published, 'run.finished', '_count', '1')).toBe(6)
    expect(store.entries.get(FLUSH_LEASE_KEY)?.options).toEqual({ expirationTtl: 120 })
    expect(bufferedKeys(store)).toEqual([])
  })
})
