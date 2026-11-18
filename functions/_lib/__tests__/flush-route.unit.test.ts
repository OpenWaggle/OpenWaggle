import { describe, expect, it } from 'vitest'
import { BufferEntryBuilder, bufferKey, serializeBufferEntry } from '../buffer-entry'
import { dayGroups, FLUSH_MIN_DAY_ENTRIES, flushTake, isAgedDay } from '../flush-selection'
import { epochDay } from '../time'
import {
  aggregatedRecords,
  BATCH_URL,
  bufferedKeys,
  bufferRequests,
  flush,
  publishedCount,
} from './flush-test-support'
import {
  MemoryKeyValueStore,
  NOW,
  PERSONLESS,
  postHogBatch,
  testUuid,
  YESTERDAY,
} from './test-support'

const EARLIER = '2026-09-30'
/** Seven full UTC days, the day itself included, have ended by today, 2026-10-02. */
const SEVEN_DAYS_OLD = '2026-09-25'
const SIX_DAYS_OLD = '2026-09-26'

describe('POST /api/v1/flush', () => {
  it("adds a day's entries up and sends only the totals, in one batch", async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    const { result, body, requests } = await flush(store)

    expect(result).toMatchObject({ outcome: 'accepted', accepted: 5, accounted: true })
    expect(result.response.status).toBe(200)
    expect(body).toEqual({
      processed: 5,
      remaining: 0,
      held: 0,
      discarded: 0,
      cleaned: 0,
      undeleted: 0,
    })
    expect(requests.map(({ url }) => url)).toEqual([BATCH_URL])
    const records = aggregatedRecords(requests)
    expect(records).toEqual(
      expect.arrayContaining([
        {
          event: 'run.finished',
          uuid: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
          ),
          timestamp: `${YESTERDAY}T12:00:00Z`,
          properties: { ...PERSONLESS, field: '_count', value: '1', count: 5 },
        },
        expect.objectContaining({
          properties: { ...PERSONLESS, field: 'duration_s', sum: 60, count: 5 },
        }),
        expect.objectContaining({
          event: 'endpoint.requests',
          properties: { ...PERSONLESS, field: 'outcome', value: 'accepted', count: 5 },
        }),
      ]),
    )
    expect(publishedCount(records, 'run.finished', 'country', 'DE')).toBe(5)
    expect(postHogBatch(requests[0]).events.at(-1)).toEqual({
      event: 'endpoint.request',
      timestamp: new Date(NOW).toISOString(),
      properties: {
        ...PERSONLESS,
        path: '/api/v1/flush',
        outcome: 'accepted',
        accepted: 5,
        status: 200,
        latency_ms: 0,
      },
    })
    const uuids = records.map((record) => record.uuid)
    expect(new Set(uuids).size).toBe(uuids.length)
    expect(bufferedKeys(store)).toEqual([])
  })

  it('holds a recent day with fewer entries than one flush may send', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, FLUSH_MIN_DAY_ENTRIES - 1)
    const { result, body, requests } = await flush(store)

    expect(result).toMatchObject({ outcome: 'skipped' })
    expect(result.accounted).toBeUndefined()
    expect(body).toEqual({
      processed: 0,
      remaining: 0,
      held: 4,
      discarded: 0,
      cleaned: 0,
      undeleted: 0,
    })
    expect(requests).toEqual([])
    expect(bufferedKeys(store)).toHaveLength(4)
  })

  it('counts only entries with an accepted app event toward the threshold', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 4)
    const countsOnly = new BufferEntryBuilder()
    countsOnly.count('endpoint.requests', '_count', '1')
    await store.put(
      bufferKey(YESTERDAY, testUuid(50)),
      serializeBufferEntry(countsOnly.build(YESTERDAY)),
    )

    const { body, requests } = await flush(store)
    expect(body).toMatchObject({ processed: 0, held: 5 })
    expect(requests).toEqual([])
  })

  it('sends a small day anyway once it is seven complete UTC days old', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 2, SEVEN_DAYS_OLD)
    await bufferRequests(store, 2, SIX_DAYS_OLD)

    const first = await flush(store)
    expect(first.body).toEqual({
      processed: 2,
      remaining: 0,
      held: 2,
      discarded: 0,
      cleaned: 0,
      undeleted: 0,
    })
    const records = aggregatedRecords(first.requests)
    expect(records.find((record) => record.properties.field === '_count')).toMatchObject({
      timestamp: `${SEVEN_DAYS_OLD}T12:00:00Z`,
      properties: { count: 2 },
    })
    expect((await flush(store)).body).toMatchObject({ processed: 0, held: 2 })
    expect(bufferedKeys(store)).toHaveLength(2)
  })

  it('never splits an aged day so that fewer than five of its entries go alone', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 51, SEVEN_DAYS_OLD)

    expect((await flush(store)).body).toMatchObject({ processed: 46, remaining: 5 })
    expect((await flush(store)).body).toMatchObject({ processed: 5, remaining: 0 })
  })

  it('sends one day per call, oldest first', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 6, YESTERDAY)
    await bufferRequests(store, 5, EARLIER)

    const first = await flush(store)
    expect(first.body).toMatchObject({ processed: 5, remaining: 6 })
    expect(aggregatedRecords(first.requests)[0]?.timestamp).toBe(`${EARLIER}T12:00:00Z`)
    expect((await flush(store)).body).toMatchObject({ processed: 6, remaining: 0 })
    expect(bufferedKeys(store)).toEqual([])
  })

  it('never leaves fewer entries of a day behind than a flush may send', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 52)

    expect((await flush(store)).body).toMatchObject({ processed: 47, remaining: 5 })
    expect((await flush(store)).body).toMatchObject({ processed: 5, remaining: 0 })
  })

  it('keeps every entry when PostHog fails, so the next flush sends them', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    const { result } = await flush(store, { respond: () => new Response('', { status: 503 }) })

    expect(result).toMatchObject({ outcome: 'forward_failed', accounted: true })
    expect(result.response.status).toBe(502)
    expect(store.deletes).toEqual([])
    expect(bufferedKeys(store)).toHaveLength(5)
  })

  it('reads past keys KV still lists after the last flush deleted them', async () => {
    const store = new MemoryKeyValueStore({ staleListing: true })
    await bufferRequests(store, 10)
    expect((await flush(store)).body).toMatchObject({ processed: 10 })
    await bufferRequests(store, 5)

    const { body, requests } = await flush(store)
    expect(body).toMatchObject({ processed: 5 })
    expect(publishedCount(aggregatedRecords(requests), 'run.finished', '_count', '1')).toBe(5)
  })

  it('deletes an entry it cannot read instead of sending it', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    const corrupt = `buf:${YESTERDAY}:${testUuid(99)}`
    await store.put(corrupt, '{"v":1,"day":"2026-10-01","c":"nope","s":[]}')
    const { body } = await flush(store)

    expect(body).toMatchObject({ processed: 5, discarded: 1 })
    expect(store.entries.has(corrupt)).toBe(false)
  })

  it.each([
    ['a browser Origin', { headers: { Origin: 'https://openwaggle.ai' } }, 403],
    ['an opaque null Origin', { headers: { Origin: 'null' } }, 403],
    ['no token', { headers: { Authorization: '' } }, 401],
    ['another token', { headers: { Authorization: 'Bearer nope' } }, 401],
    ['an unset STATS_SNAPSHOT_TOKEN', { env: { STATS_SNAPSHOT_TOKEN: ' ' } }, 503],
    ['no STATS_KV binding', { env: { STATS_KV: undefined } }, 503],
    ['an unset POSTHOG_PROJECT_KEY', { env: { POSTHOG_PROJECT_KEY: undefined } }, 503],
    ['a POSTHOG_HOST outside the EU', { env: { POSTHOG_HOST: 'https://us.i.posthog.com' } }, 503],
  ])('refuses a flush with %s and touches nothing', async (_label, options, status) => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    const { result, requests } = await flush(store, options)

    expect(result.response.status).toBe(status)
    expect(requests).toEqual([])
    expect(store.deletes).toEqual([])
  })

  it('accepts a request whose Origin no browser sends', async () => {
    const store = new MemoryKeyValueStore()
    await bufferRequests(store, 5)
    expect((await flush(store, { headers: { Origin: 'app://-' } })).body).toMatchObject({
      processed: 5,
    })
  })

  it('tells the workflow when it is only not configured', async () => {
    const { body } = await flush(new MemoryKeyValueStore(), {
      env: { POSTHOG_PROJECT_KEY: undefined },
    })
    expect(body).toEqual({ skipped: 'POSTHOG_PROJECT_KEY is not set' })
  })
})

describe('flush selection', () => {
  it('counts a day as aged from the seventh day after it', () => {
    const today = epochDay(NOW)
    expect(isAgedDay(SEVEN_DAYS_OLD, today)).toBe(true)
    expect(isAgedDay(SIX_DAYS_OLD, today)).toBe(false)
    expect(isAgedDay('not-a-day', today)).toBe(false)
  })

  it('leaves none or enough entries of a day', () => {
    expect([1, 5, 50, 52, 54, 55, 60, 200].map(flushTake)).toEqual([1, 5, 50, 47, 49, 50, 50, 50])
  })

  it('groups buffer keys by day, oldest first, ignoring keys it did not write', () => {
    expect(
      dayGroups([
        `buf:${YESTERDAY}:${testUuid(1)}`,
        `buf:${EARLIER}:${testUuid(2)}`,
        'web-salt:2026-10-01',
        'buf:yesterday:x',
        `buf:${YESTERDAY}:${testUuid(3)}`,
      ]),
    ).toEqual([
      { day: EARLIER, keys: [`buf:${EARLIER}:${testUuid(2)}`] },
      {
        day: YESTERDAY,
        keys: [`buf:${YESTERDAY}:${testUuid(1)}`, `buf:${YESTERDAY}:${testUuid(3)}`],
      },
    ])
  })
})
