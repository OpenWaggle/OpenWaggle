import { describe, expect, it } from 'vitest'
import type { KeyValueStore } from '../cloudflare'
import { stackFrames } from '../exception-report'
import { handleStatisticsRequest, routeForPath } from '../handler'
import { SNAPSHOT_STATE_KEY } from '../snapshot-route'
import {
  BROWSER_USER_AGENT,
  backgroundTasks,
  CLIENT_ADDRESS,
  environment,
  eventsBody,
  MemoryKeyValueStore,
  PERSONLESS,
  postHogBatch,
  runFinished,
  SNAPSHOT_TOKEN,
  statisticsRequest,
  testDependencies,
} from './test-support'

const SENTRY_DSN = 'https://publickey@o42.ingest.de.sentry.io/4507'
const RECORD_FIELDS = ['path', 'outcome', 'field', 'accepted', 'rejected', 'status', 'latency_ms']

function snapshotRequest() {
  return statisticsRequest('/api/v1/snapshot', {
    body: JSON.stringify({ schema: 1, releases: [], traffic: null, npm: [] }),
    headers: { Authorization: `Bearer ${SNAPSHOT_TOKEN}` },
  })
}

function eventsRequest(headers: Record<string, string> = {}) {
  return statisticsRequest('/api/v1/events', {
    body: eventsBody([runFinished(), runFinished({ prompt: 'my secret prompt' })]),
    headers: { 'Content-Type': 'application/json', ...headers },
    cf: { country: 'DE' },
  })
}

function sentryEnvelope(requests: readonly { url: string; init: RequestInit }[]) {
  const sentry = requests.find(
    ({ url }) => url === 'https://o42.ingest.de.sentry.io/api/4507/envelope/',
  )
  return String(sentry?.init.body)
}

async function handle(request: Request, overrides = {}) {
  const test = testDependencies()
  const background = backgroundTasks()
  const response = await handleStatisticsRequest(
    request,
    environment(overrides),
    background.tasks,
    test.dependencies,
  )
  await background.settle()
  return { ...test, response }
}

describe('statistics endpoint requests', () => {
  it('routes the five paths, with or without a trailing slash', () => {
    expect(routeForPath('/api/v1/events')).toBe('events')
    expect(routeForPath('/api/v1/errors/')).toBe('errors')
    expect(routeForPath('/api/v1/web')).toBe('web')
    expect(routeForPath('/api/v1/snapshot')).toBe('snapshot')
    expect(routeForPath('/api/v1/flush')).toBe('flush')
    expect(routeForPath('/api/v1/other')).toBeUndefined()
  })

  it('logs an app request in one line and counts it only in the buffer, never alone', async () => {
    const store = new MemoryKeyValueStore()
    const request = eventsRequest({ 'CF-Connecting-IP': CLIENT_ADDRESS, Cookie: 'session=abc' })
    const { response, lines, requests } = await handle(request, { STATS_KV: store })

    expect(response.status).toBe(202)
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0] ?? '')
    expect(record).toEqual({
      path: '/api/v1/events',
      outcome: 'accepted',
      field: '(unpublished)',
      accepted: 1,
      rejected: 1,
      status: 202,
      latency_ms: 0,
    })
    expect(Object.keys(record).every((key) => RECORD_FIELDS.includes(key))).toBe(true)
    expect(requests).toEqual([])
    expect(JSON.stringify(store.values('buf:'))).toContain(
      '"endpoint.requests","outcome","accepted",1',
    )
    for (const output of [lines.join('\n'), JSON.stringify([...store.entries])]) {
      expect(output).not.toContain(CLIENT_ADDRESS)
      expect(output).not.toContain('session=abc')
      expect(output).not.toContain('my secret prompt')
    }
  })

  it('sends one endpoint.request event for a request to another route', async () => {
    const request = statisticsRequest('/api/v1/web', {
      body: JSON.stringify({ type: 'pageview', path: '/', referrer: '' }),
      headers: { Origin: 'https://openwaggle.ai', 'User-Agent': BROWSER_USER_AGENT, DNT: '1' },
    })
    const { response, lines, requests } = await handle(request)

    expect(response.status).toBe(204)
    const record = JSON.parse(lines[0] ?? '')
    expect(record).toEqual({ path: '/api/v1/web', outcome: 'skipped', status: 204, latency_ms: 0 })
    expect(postHogBatch(requests[0]).events).toEqual([
      {
        event: 'endpoint.request',
        timestamp: expect.any(String),
        properties: { ...PERSONLESS, ...record },
      },
    ])
  })

  it('logs an unknown path without the path itself and sends nothing', async () => {
    const { response, lines, requests } = await handle(
      statisticsRequest('/api/v1/users/alice@example.com'),
    )

    expect(response.status).toBe(404)
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      path: '(unknown)',
      outcome: 'rejected',
      status: 404,
      latency_ms: 0,
    })
    expect(lines[0]).not.toContain('alice')
    expect(requests).toEqual([])
  })

  it('answers other methods with 405 and an Allow header, and sends nothing', async () => {
    const { response, lines, requests } = await handle(
      statisticsRequest('/api/v1/web', { method: 'GET' }),
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ outcome: 'rejected', field: 'method' })
    expect(requests).toEqual([])
  })

  it('sends no endpoint.request event while PostHog is not configured', async () => {
    const request = statisticsRequest('/api/v1/errors', {
      body: '{}\n',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
    })
    const { requests, lines } = await handle(request, { POSTHOG_PROJECT_KEY: undefined })

    expect(requests).toEqual([])
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ outcome: 'skipped', status: 204 })
  })

  it('turns an exception into a 500 and a scrubbed Sentry report', async () => {
    const store = new MemoryKeyValueStore()
    await store.put(SNAPSHOT_STATE_KEY, '{"version":1}')
    const { response, lines, requests } = await handle(snapshotRequest(), {
      SENTRY_DSN,
      STATS_SNAPSHOT_TOKEN: SNAPSHOT_TOKEN,
      STATS_KV: store,
    })

    expect(response.status).toBe(500)
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      path: '/api/v1/snapshot',
      outcome: 'error',
      status: 500,
      latency_ms: 0,
    })
    const [header, itemHeader, event] = sentryEnvelope(requests)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(header).toMatchObject({ dsn: SENTRY_DSN, event_id: 'a'.repeat(32) })
    expect(itemHeader).toMatchObject({ type: 'event' })
    expect(event).toMatchObject({
      event_id: 'a'.repeat(32),
      level: 'error',
      tags: { route: '/api/v1/snapshot', 'openwaggle.error_origin': 'application' },
      exception: {
        values: [
          {
            type: 'EndpointError',
            value: 'snapshot-state:v1 in STATS_KV is unreadable',
            mechanism: { type: 'generic', handled: true },
          },
        ],
      },
    })
  })

  it("withholds a foreign error's message, which could quote request data", async () => {
    const store: KeyValueStore = {
      get: () => Promise.reject(new TypeError('Invalid URL: https://alice.example/?token=1')),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      list: () => Promise.resolve({ keys: [], list_complete: true }),
    }
    const { response, requests } = await handle(snapshotRequest(), {
      SENTRY_DSN,
      STATS_SNAPSHOT_TOKEN: SNAPSHOT_TOKEN,
      STATS_KV: store,
    })

    expect(response.status).toBe(500)
    expect(sentryEnvelope(requests)).toContain('"type":"TypeError"')
    expect(sentryEnvelope(requests)).not.toContain('alice.example')
  })

  it('reports no exception while SENTRY_DSN is unset', async () => {
    const store = new MemoryKeyValueStore()
    await store.put(SNAPSHOT_STATE_KEY, 'corrupt')
    const { response, requests } = await handle(snapshotRequest(), {
      STATS_SNAPSHOT_TOKEN: SNAPSHOT_TOKEN,
      STATS_KV: store,
    })

    expect(response.status).toBe(500)
    expect(requests.map(({ url }) => url)).toEqual(['https://eu.i.posthog.com/batch/'])
  })

  it('reports no exception to a Sentry project outside the EU', async () => {
    const store = new MemoryKeyValueStore()
    await store.put(SNAPSHOT_STATE_KEY, 'corrupt')
    const { requests } = await handle(snapshotRequest(), {
      SENTRY_DSN: 'https://publickey@o42.ingest.us.sentry.io/4507',
      STATS_SNAPSHOT_TOKEN: SNAPSHOT_TOKEN,
      STATS_KV: store,
    })

    expect(requests.some(({ url }) => url.includes('sentry.io'))).toBe(false)
  })
})

describe('endpoint exception stacks', () => {
  it('parses V8 frames, oldest call first', () => {
    const stack = [
      'Error: boom',
      '    at readState (functionsWorker-0.123.js:10:5)',
      '    at async handleSnapshotRequest (functionsWorker-0.123.js:20:7)',
      '    at functionsWorker-0.123.js:30:9',
    ].join('\n')

    expect(stackFrames(stack)).toEqual([
      {
        function: '<anonymous>',
        filename: 'app:///functionsWorker-0.123.js',
        lineno: 30,
        colno: 9,
        in_app: true,
      },
      {
        function: 'async handleSnapshotRequest',
        filename: 'app:///functionsWorker-0.123.js',
        lineno: 20,
        colno: 7,
        in_app: true,
      },
      {
        function: 'readState',
        filename: 'app:///functionsWorker-0.123.js',
        lineno: 10,
        colno: 5,
        in_app: true,
      },
    ])
    expect(stackFrames(undefined)).toEqual([])
    expect(stackFrames('    at run (/Users/alice/repo/functions/_lib/x.ts:1:2)')).toEqual([
      { function: 'run', filename: 'app:///x.ts', lineno: 1, colno: 2, in_app: true },
    ])
  })
})
