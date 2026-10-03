import { describe, expect, it } from 'vitest'
import { EndpointError } from '../exception-report'
import { FLUSH_MANIFEST_KEY } from '../flush-manifest'
import {
  aggregatedRecords,
  bufferedKeys,
  bufferRequests,
  flush,
  type PublishedRecord,
  publishedCount,
} from './flush-test-support'
import { bufferExpiry, MemoryKeyValueStore, YESTERDAY } from './test-support'

function uuidsOf(records: readonly PublishedRecord[]) {
  return records.map((record) => record.uuid).sort()
}

describe('flush manifest', () => {
  it('records the exact set before sending and removes it only once PostHog accepted', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    const keys = bufferedKeys(store).sort()
    let duringSend: { readonly value: string } | undefined
    const { body } = await flush(store, {
      respond: () => {
        duringSend = store.entries.get(FLUSH_MANIFEST_KEY)
        return new Response('{"status":1}')
      },
    })

    expect(body).toMatchObject({ processed: 5, undeleted: 0 })
    expect(duringSend).toEqual({
      value: expect.any(String),
      options: { expiration: bufferExpiry(YESTERDAY) },
    })
    const manifest = JSON.parse(duringSend?.value ?? '{}')
    expect({ ...manifest, keys: [...manifest.keys].sort() }).toEqual({ v: 1, day: YESTERDAY, keys })
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(false)
  })

  it('resends exactly the recorded set, under the same UUIDs, after an unknown outcome', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    const unknown = await flush(store, {
      respond: () => Promise.reject(new TypeError('connection reset')),
    })
    expect(unknown.result.response.status).toBe(502)
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(true)

    await bufferRequests(store, 5)
    const resent = await flush(store)
    expect(resent.body).toMatchObject({ processed: 5, remaining: 1 })
    expect(uuidsOf(aggregatedRecords(resent.requests))).toEqual(
      uuidsOf(aggregatedRecords(unknown.requests)),
    )
    expect(publishedCount(aggregatedRecords(resent.requests), 'run.finished', '_count', '1')).toBe(
      5,
    )
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(false)

    const late = await flush(store)
    expect(late.body).toMatchObject({ processed: 5, remaining: 0 })
    const lateUuids = new Set(uuidsOf(aggregatedRecords(late.requests)))
    expect(uuidsOf(aggregatedRecords(resent.requests)).some((uuid) => lateUuids.has(uuid))).toBe(
      false,
    )
    expect(bufferedKeys(store)).toEqual([])
  })

  it('finishes an accepted flush whose manifest was left behind, without sending it again', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    store.failingDeletes.add(FLUSH_MANIFEST_KEY)
    // The manifest is no entry left in KV: the next call only deletes it.
    expect((await flush(store)).body).toMatchObject({ processed: 5, undeleted: 0 })
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(true)

    store.failingDeletes.clear()
    const next = await flush(store)
    expect(next.body).toMatchObject({ processed: 0, undeleted: 0 })
    expect(next.requests).toEqual([])
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(false)
  })

  it('reports a manifest it could not delete when finishing it was its only job', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    store.failingDeletes.add(FLUSH_MANIFEST_KEY)
    expect((await flush(store)).body).toMatchObject({ processed: 5, undeleted: 0 })

    const stuck = await flush(store)
    expect(stuck.body).toMatchObject({ processed: 0, remaining: 1, undeleted: 1 })
    expect(stuck.requests).toEqual([])
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(true)
  })

  it('sends nothing when the manifest cannot be recorded', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    store.failingPuts.add(FLUSH_MANIFEST_KEY)
    const { result, requests } = await flush(store)

    expect(result.response.status).toBe(503)
    expect(requests).toEqual([])
    expect(bufferedKeys(store)).toHaveLength(5)
  })

  it('stops on an unreadable manifest instead of guessing what it held', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    await store.put(FLUSH_MANIFEST_KEY, '{"v":1,"day":"2026-10-01","keys":["web-salt:x"]}')

    await expect(flush(store)).rejects.toThrow(EndpointError)
  })
})
