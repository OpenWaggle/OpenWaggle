import { describe, expect, it } from 'vitest'
import { BufferEntryBuilder, bufferKey, flushedKey, serializeBufferEntry } from '../buffer-entry'
import { FLUSH_KV_OPERATIONS } from '../flush-budget'
import { FLUSH_MANIFEST_KEY } from '../flush-manifest'
import { bufferedKeys, bufferRequests, flush } from './flush-test-support'
import { MemoryKeyValueStore, testUuid, YESTERDAY } from './test-support'

const EARLIER = '2026-09-30'
const OLDER = '2026-09-28'

function entryText(day: string) {
  const builder = new BufferEntryBuilder()
  builder.count('app.opened', '_count', '1')
  return serializeBufferEntry(builder.build(day))
}

/** Flushes the way the workflow does, passing each cursor on, and records each call's KV cost. */
async function drain(store: MemoryKeyValueStore, calls = 60) {
  const costs: number[] = []
  const statuses: number[] = []
  let cursor: string | undefined
  for (let call = 0; call < calls; call += 1) {
    const before = store.operations
    const { result, body } = await flush(store, cursor === undefined ? {} : { cursor })
    costs.push(store.operations - before)
    statuses.push(result.response.status)
    cursor = typeof body.cursor === 'string' ? body.cursor : undefined
    const progressed = body.processed > 0 || body.cleaned > 0 || cursor !== undefined
    if (body.remaining === 0 || !progressed) break
  }
  return { costs, statuses }
}

describe('flush KV budget', () => {
  it(`counts every KV operation and stays within ${String(FLUSH_KV_OPERATIONS)} per call`, async () => {
    const store = new MemoryKeyValueStore()
    for (const day of [YESTERDAY, EARLIER]) await bufferRequests(store, 60, day)
    for (let index = 0; index < 25; index += 1) {
      await store.put(bufferKey(YESTERDAY, testUuid(5000 + index)), 'corrupt')
      const published = bufferKey(EARLIER, testUuid(6000 + index))
      await store.put(published, entryText(EARLIER))
      await store.put(flushedKey(published), '1')
    }
    const manifestKeys = Array.from({ length: 55 }, (_key, index) =>
      bufferKey(OLDER, testUuid(7000 + index)),
    )
    for (const key of manifestKeys.slice(0, 30)) await store.put(key, entryText(OLDER))
    await store.put(FLUSH_MANIFEST_KEY, JSON.stringify({ v: 1, day: OLDER, keys: manifestKeys }))

    const { costs, statuses } = await drain(store)

    expect(Math.max(...costs)).toBeLessThanOrEqual(FLUSH_KV_OPERATIONS)
    expect(statuses.every((status) => status === 200)).toBe(true)
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(false)
    expect(bufferedKeys(store)).toEqual([])
  })

  it('stays within the budget when hundreds of published entries are still listed', async () => {
    const store = new MemoryKeyValueStore()
    for (let index = 0; index < 450; index += 1) {
      const published = bufferKey(OLDER, testUuid(9000 + index))
      await store.put(published, entryText(OLDER))
      await store.put(flushedKey(published), '1')
    }
    await bufferRequests(store, 60, YESTERDAY)

    const { costs, statuses } = await drain(store)

    expect(Math.max(...costs)).toBeGreaterThan(FLUSH_KV_OPERATIONS - 150)
    expect(Math.max(...costs)).toBeLessThanOrEqual(FLUSH_KV_OPERATIONS)
    expect(statuses.every((status) => status === 200)).toBe(true)
    expect(bufferedKeys(store)).toEqual([])
  })

  it('deletes at most twenty leftover entries per call', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    const corrupt = Array.from({ length: 25 }, (_key, index) =>
      bufferKey(YESTERDAY, testUuid(8000 + index)),
    )
    for (const key of corrupt) await store.put(key, 'corrupt')

    expect((await flush(store)).body).toMatchObject({ processed: 5, discarded: 25 })
    expect(corrupt.filter((key) => store.entries.has(key))).toHaveLength(5)
    await flush(store)
    expect(corrupt.filter((key) => store.entries.has(key))).toEqual([])
  })
})

describe('flush listing', () => {
  it('follows the cursor past an empty page', async () => {
    const store = new MemoryKeyValueStore({ emptyFirstPage: true })
    await bufferRequests(store, 5)

    expect((await flush(store)).body).toMatchObject({ processed: 5, remaining: 0 })
    expect(store.lists.map((options) => options.cursor)).toEqual([undefined, '0'])
  })

  it('reads a day spread over several short pages', async () => {
    const store = new MemoryKeyValueStore({ pageSize: 2 })
    await bufferRequests(store, 5)

    expect((await flush(store)).body).toMatchObject({ processed: 5, remaining: 0 })
    expect(store.lists).toHaveLength(3)
  })

  it('hands back a cursor so more than five pages of waiting entries cannot stall the flush', async () => {
    const store = new MemoryKeyValueStore({ pageSize: 2 })
    for (const day of ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29']) {
      await bufferRequests(store, 3, day)
    }
    await bufferRequests(store, 5, YESTERDAY)

    const first = await flush(store)
    expect(first.body).toMatchObject({ processed: 0, held: 10, cursor: expect.any(String) })
    expect((await flush(store)).body).toMatchObject({ processed: 0 })
    const next = await flush(store, { cursor: first.body.cursor })
    expect(next.body).toMatchObject({ processed: 5 })
    expect(bufferedKeys(store)).toHaveLength(12)
  })
})
