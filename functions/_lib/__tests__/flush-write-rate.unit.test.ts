import { describe, expect, it } from 'vitest'
import {
  FLUSH_CALL_INTERVAL_MS,
  flushBufferedStatistics,
} from '../../../scripts/usage-stats-snapshot-endpoint'
import { FLUSH_LEASE_KEY } from '../flush-finish'
import { FLUSH_MANIFEST_KEY } from '../flush-manifest'
import { handleStatisticsRequest } from '../handler'
import {
  aggregatedRecords,
  bufferedKeys,
  bufferRequests,
  flush,
  totalCount,
} from './flush-test-support'
import {
  backgroundTasks,
  environment,
  FakeClock,
  MemoryKeyValueStore,
  SNAPSHOT_TOKEN,
  testDependencies,
  YESTERDAY,
} from './test-support'

const EARLIER = '2026-09-30'

/** App reports reach KV well before a flush deletes them; a second is enough for its limit. */
async function settle(clock: FakeClock) {
  await clock.sleep(FLUSH_CALL_INTERVAL_MS)
}

/** A namespace that refuses reading the lease, as during a KV incident. */
class UnreadableLeaseStore extends MemoryKeyValueStore {
  override async get(key: string) {
    if (key === FLUSH_LEASE_KEY) throw new Error('KV GET failed: 500')
    return super.get(key)
  }
}

describe('flush and KV write limits', () => {
  it('retries the lease once a second later when KV refuses it', async () => {
    const clock = new FakeClock()
    const store = new MemoryKeyValueStore({ oneWritePerKeyPerSecond: clock.now })
    await flush(store, { clock })

    await bufferRequests(store, 5)
    const second = await flush(store, { clock })
    expect(store.refusedWrites).toEqual([FLUSH_LEASE_KEY])
    expect(second.sleeps).toContain(1100)
    expect(second.body).toMatchObject({ processed: 5 })
  })

  it('answers 503 when the lease cannot be written even then', async () => {
    const store = new MemoryKeyValueStore()
    store.failingPuts.add(FLUSH_LEASE_KEY)
    await bufferRequests(store, 5)
    const { result, requests } = await flush(store)

    expect(result.response.status).toBe(503)
    expect(requests).toEqual([])
  })

  it('answers 503, not a takeover, when the lease cannot be read', async () => {
    const store = new UnreadableLeaseStore()
    await bufferRequests(store, 5)
    const { result, body, requests } = await flush(store)

    expect(result.response.status).toBe(503)
    expect(body).toEqual({ error: 'the flush lease could not be read' })
    expect(requests).toEqual([])
    expect(bufferedKeys(store)).toHaveLength(5)
  })

  it('spaces its writes to the manifest key a second apart', async () => {
    const clock = new FakeClock()
    const store = new MemoryKeyValueStore({ oneWritePerKeyPerSecond: clock.now })
    await bufferRequests(store, 5)
    await settle(clock)
    const { body, sleeps } = await flush(store, { clock })

    expect(body).toMatchObject({ processed: 5, undeleted: 0 })
    expect(store.refusedWrites).toEqual([])
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(false)
    expect(sleeps.some((milliseconds) => milliseconds > 0)).toBe(true)
  })

  it('finishes a left-behind manifest and writes the next one without a refused write', async () => {
    const clock = new FakeClock()
    const store = new MemoryKeyValueStore({ oneWritePerKeyPerSecond: clock.now })
    await bufferRequests(store, 5)
    await settle(clock)
    store.failingDeletes.add(FLUSH_MANIFEST_KEY)
    expect((await flush(store, { clock })).body).toMatchObject({ processed: 5, undeleted: 0 })

    store.failingDeletes.clear()
    await bufferRequests(store, 5)
    await settle(clock)
    const next = await flush(store, { clock })
    expect(next.body).toMatchObject({ processed: 5, undeleted: 0 })
    expect(store.refusedWrites).toEqual([])
    expect(store.entries.has(FLUSH_MANIFEST_KEY)).toBe(false)
  })

  it('fails the run, instead of stalling green, when the manifest can never be deleted', async () => {
    const clock = new FakeClock()
    const store = new MemoryKeyValueStore({ oneWritePerKeyPerSecond: clock.now })
    await bufferRequests(store, 5, YESTERDAY)
    await bufferRequests(store, 6, EARLIER)
    await settle(clock)
    store.failingDeletes.add(FLUSH_MANIFEST_KEY)
    const endpoint = testDependencies(undefined, clock)
    const background = backgroundTasks()
    const env = environment({ STATS_KV: store, STATS_SNAPSHOT_TOKEN: SNAPSHOT_TOKEN })

    const run = flushBufferedStatistics(
      {
        env: { STATS_SNAPSHOT_TOKEN: SNAPSHOT_TOKEN },
        log: () => undefined,
        fetch: (url, init) =>
          handleStatisticsRequest(
            new Request(url, init),
            env,
            background.tasks,
            endpoint.dependencies,
          ),
        sleep: clock.sleep,
        now: clock.now,
      },
      SNAPSHOT_TOKEN,
    )

    await expect(run).rejects.toThrow('could not delete (1)')
    await background.settle()
    expect(bufferedKeys(store)).toHaveLength(5)
  })

  it('drains the buffer through the real endpoint without one refused write', async () => {
    const clock = new FakeClock()
    const store = new MemoryKeyValueStore({ oneWritePerKeyPerSecond: clock.now })
    await bufferRequests(store, 60, YESTERDAY)
    await bufferRequests(store, 60, EARLIER)
    await settle(clock)
    const endpoint = testDependencies(undefined, clock)
    const background = backgroundTasks()
    const env = environment({ STATS_KV: store, STATS_SNAPSHOT_TOKEN: SNAPSHOT_TOKEN })
    const pauses: number[] = []
    const lines: string[] = []

    await flushBufferedStatistics(
      {
        env: { STATS_SNAPSHOT_TOKEN: SNAPSHOT_TOKEN },
        log: (line) => {
          lines.push(line)
        },
        fetch: (url, init) =>
          handleStatisticsRequest(
            new Request(url, init),
            env,
            background.tasks,
            endpoint.dependencies,
          ),
        sleep: async (milliseconds) => {
          pauses.push(milliseconds)
          await clock.sleep(milliseconds)
        },
        now: clock.now,
      },
      SNAPSHOT_TOKEN,
    )
    await background.settle()

    expect(store.refusedWrites).toEqual([])
    expect(bufferedKeys(store)).toEqual([])
    expect(pauses.length).toBeGreaterThan(0)
    expect(pauses.every((milliseconds) => milliseconds >= 1100)).toBe(true)
    expect(lines.at(-1)).toMatch(/^Flushed 120 buffered entries in \d+ calls/u)
    const batches = endpoint.requests.filter(({ url }) => url === 'https://eu.i.posthog.com/batch/')
    const published = batches.flatMap((batch) => aggregatedRecords([batch]))
    expect(totalCount(published, 'run.finished', '_count', '1')).toBe(120)
  })
})
