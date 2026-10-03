import { expect } from 'vitest'
import type { KeyValueStore } from '../cloudflare'
import { handleEventsRequest } from '../events-route'
import { handleFlushRequest } from '../flush-route'
import {
  CONTEXT,
  environment,
  eventsBody,
  type FakeClock,
  type MemoryKeyValueStore,
  type Responder,
  routeContext,
  runFinished,
  SNAPSHOT_TOKEN,
  statisticsRequest,
  testDependencies,
  testUuid,
  YESTERDAY,
} from './test-support'

export const BATCH_URL = 'https://eu.i.posthog.com/batch/'

type EventsOf = (index: number) => readonly unknown[]
type ContextOf = (index: number) => Readonly<Record<string, string>>

/**
 * UUIDs stay unique across calls, as random ones are, so no test reuses a flushed key and two
 * flushes never share a lease nonce.
 */
let uniqueUuids = 1000

function uniqueUuid() {
  uniqueUuids += 1
  return testUuid(uniqueUuids)
}

/** Stores `count` app requests through the events route, as the app would send them. */
export async function bufferRequests(
  store: KeyValueStore,
  count: number,
  day = YESTERDAY,
  eventsOf: EventsOf = (index) => [runFinished({ duration_s: 10 + index }, day)],
  contextOf: ContextOf = () => CONTEXT,
) {
  const test = testDependencies()
  const dependencies = { ...test.dependencies, randomUuid: uniqueUuid }
  for (let index = 0; index < count; index += 1) {
    const request = statisticsRequest('/api/v1/events', {
      body: eventsBody(eventsOf(index), contextOf(index)),
      headers: { 'Content-Type': 'application/json' },
      cf: { country: 'DE' },
    })
    const result = await handleEventsRequest(
      routeContext(request, environment({ STATS_KV: store }), dependencies),
    )
    expect(result.response.status).toBe(202)
  }
}

export interface FlushOptions {
  readonly env?: Record<string, unknown>
  readonly headers?: Record<string, string>
  readonly respond?: Responder
  readonly cursor?: string
  readonly clock?: FakeClock
}

export async function flush(store: KeyValueStore | undefined, options: FlushOptions = {}) {
  const test = testDependencies(options.respond, options.clock)
  const request = statisticsRequest('/api/v1/flush', {
    headers: { Authorization: `Bearer ${SNAPSHOT_TOKEN}`, ...options.headers },
    ...(options.cursor === undefined ? {} : { body: JSON.stringify({ cursor: options.cursor }) }),
  })
  const env = environment({ STATS_KV: store, STATS_SNAPSHOT_TOKEN: SNAPSHOT_TOKEN, ...options.env })
  const dependencies = { ...test.dependencies, randomUuid: uniqueUuid }
  const result = await handleFlushRequest(routeContext(request, env, dependencies))
  return { ...test, result, body: await result.response.json() }
}

export function bufferedKeys(store: MemoryKeyValueStore) {
  return [...store.entries.keys()].filter((key) => key.startsWith('buf:'))
}

export interface PublishedRecord {
  readonly event: string
  readonly uuid?: string
  readonly timestamp: string
  readonly properties: Record<string, unknown>
}

/** The aggregated records of a flush's batch, without its own `endpoint.request` event. */
export function aggregatedRecords(requests: readonly { url: string; init: RequestInit }[]) {
  const batch = requests.find(({ url }) => url === BATCH_URL)
  if (typeof batch?.init.body !== 'string') throw new Error('expected a PostHog batch')
  const records: PublishedRecord[] = JSON.parse(batch.init.body).batch
  return records.filter((record) => record.uuid !== undefined)
}

/** The published value of one breakdown row, or `undefined` when it is not published. */
export function publishedCount(
  records: readonly PublishedRecord[],
  event: string,
  field: string,
  value: string,
) {
  return records.find(
    (record) =>
      record.event === event &&
      record.properties.field === field &&
      record.properties.value === value,
  )?.properties.count
}

/** The count of one row added up over records from several batches. */
export function totalCount(
  records: readonly PublishedRecord[],
  event: string,
  field: string,
  value: string,
) {
  return records
    .filter(
      (record) =>
        record.event === event &&
        record.properties.field === field &&
        record.properties.value === value,
    )
    .reduce((sum, record) => sum + Number(record.properties.count), 0)
}
