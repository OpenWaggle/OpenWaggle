import { describe, expect, it } from 'vitest'
import { bearerTokenMatches } from '../bearer-token'
import { EndpointError } from '../exception-report'
import { handleSnapshotRequest, SNAPSHOT_STATE_KEY } from '../snapshot-route'
import {
  environment,
  MemoryKeyValueStore,
  NOW,
  postHogBatch,
  type Responder,
  routeContext,
  statisticsRequest,
  SNAPSHOT_TOKEN as TOKEN,
  testDependencies,
} from './test-support'

const SNAPSHOT = {
  schema: 1,
  releases: [
    {
      tag: 'v1.0.0-beta.4',
      assets: [{ id: 1, name: 'openwaggle-1.0.0-beta.4-x64.exe', download_count: 3 }],
    },
  ],
  traffic: null,
  npm: [{ name: '@openwaggle/pi-waggle', days: [{ day: '2026-10-01', downloads: 6 }] }],
}

function snapshotRequest(
  body: unknown = SNAPSHOT,
  authorization: string | null = `Bearer ${TOKEN}`,
  headers: Record<string, string> = {},
) {
  return statisticsRequest('/api/v1/snapshot', {
    body: JSON.stringify(body),
    headers: { ...(authorization === null ? {} : { Authorization: authorization }), ...headers },
  })
}

async function send(
  request: Request,
  store: MemoryKeyValueStore | undefined = new MemoryKeyValueStore(),
  overrides = {},
  respond?: Responder,
) {
  const test = testDependencies(respond)
  const env = environment({ STATS_SNAPSHOT_TOKEN: TOKEN, STATS_KV: store, ...overrides })
  const result = await handleSnapshotRequest(routeContext(request, env, test.dependencies))
  return { ...test, result, body: await result.response.json() }
}

function manyAssets(releases: number, assetsPerRelease: number) {
  return Array.from({ length: releases }, (_release, index) => ({
    tag: `v0.${String(index)}.0`,
    assets: Array.from({ length: assetsPerRelease }, (_asset, asset) => ({
      id: index * 1000 + asset + 1,
      name: `openwaggle-${String(asset)}-x64.exe`,
      download_count: 1,
    })),
  }))
}

describe('POST /api/v1/snapshot', () => {
  it('forwards the deltas and stores the new totals afterwards', async () => {
    const store = new MemoryKeyValueStore()
    const { result, body, requests } = await send(snapshotRequest(), store)

    expect(result).toMatchObject({ outcome: 'accepted', accepted: 2, accounted: true })
    expect(result.response.status).toBe(202)
    expect(body).toEqual({ events: 2 })
    expect(requests).toHaveLength(1)
    const events = postHogBatch(requests[0]).events
    expect(events.map((event: { event: string }) => event.event)).toEqual([
      'github.download',
      'npm.downloads',
      'endpoint.request',
    ])
    expect(events[2].properties).toMatchObject({
      path: '/api/v1/snapshot',
      outcome: 'accepted',
      accepted: 2,
      status: 202,
    })
    expect(store.writes).toEqual([SNAPSHOT_STATE_KEY])
    const stored = JSON.parse(store.entries.get(SNAPSHOT_STATE_KEY)?.value ?? '{}')
    expect(stored).toMatchObject({
      assets: { 1: 3 },
      npm: { '@openwaggle/pi-waggle': { '2026-10-01': 6 } },
      lastSnapshotAt: NOW,
    })

    const repeat = await send(snapshotRequest(), store)
    expect(repeat.body).toEqual({ events: 0 })
    expect(repeat.requests).toEqual([])
    expect(repeat.result.accounted).toBe(false)
  })

  it('sends every delta in one batch, however many there are', async () => {
    const { body, requests } = await send(
      snapshotRequest({ ...SNAPSHOT, releases: manyAssets(7, 200), npm: [] }),
    )

    expect(body).toEqual({ events: 1400 })
    expect(requests).toHaveLength(1)
    expect(postHogBatch(requests[0]).events).toHaveLength(1401)
  })

  it('still treats the next snapshot as the baseline after an empty one', async () => {
    const store = new MemoryKeyValueStore()
    await send(snapshotRequest({ schema: 1, releases: [], traffic: null, npm: [] }), store)
    const { requests } = await send(snapshotRequest(), store)

    expect(postHogBatch(requests[0]).events[0].properties).toMatchObject({ baseline: true })
  })

  it.each([
    ['no Authorization header', null],
    ['another token', 'Bearer not-the-token'],
    ['the token without the Bearer scheme', TOKEN],
    ['a token with a prefix', `Bearer x${TOKEN}`],
  ])('refuses %s', async (_label, authorization) => {
    const store = new MemoryKeyValueStore()
    const { result, requests } = await send(snapshotRequest(SNAPSHOT, authorization), store)

    expect(result).toMatchObject({ outcome: 'rejected', field: 'authorization' })
    expect(result.response.status).toBe(401)
    expect(requests).toEqual([])
    expect(store.writes).toEqual([])
  })

  it('accepts a request whose Origin no browser sends', async () => {
    const request = snapshotRequest(SNAPSHOT, `Bearer ${TOKEN}`, { Origin: 'file://' })
    expect((await send(request)).result.outcome).toBe('accepted')
  })

  it.each([['https://openwaggle.ai'], ['null']])(
    'refuses a request from a browser, Origin %s',
    async (origin) => {
      const { result, requests } = await send(
        snapshotRequest(SNAPSHOT, `Bearer ${TOKEN}`, { Origin: origin }),
      )
      expect(result).toMatchObject({ outcome: 'rejected', field: 'origin' })
      expect(result.response.status).toBe(403)
      expect(requests).toEqual([])
    },
  )

  it.each([
    [
      'STATS_SNAPSHOT_TOKEN is unset',
      { STATS_SNAPSHOT_TOKEN: '' },
      'STATS_SNAPSHOT_TOKEN is not set',
    ],
    ['STATS_KV is not bound', { STATS_KV: undefined }, 'STATS_KV is not bound'],
    [
      'POSTHOG_PROJECT_KEY is unset',
      { POSTHOG_PROJECT_KEY: undefined },
      'POSTHOG_PROJECT_KEY is not set',
    ],
    [
      'POSTHOG_HOST is outside the EU',
      { POSTHOG_HOST: 'https://app.posthog.com' },
      'POSTHOG_HOST must be https://eu.i.posthog.com',
    ],
  ])('stores nothing and says so while %s', async (_label, overrides, skipped) => {
    const store = new MemoryKeyValueStore()
    const { result, body, requests } = await send(snapshotRequest(), store, overrides)

    expect(result).toMatchObject({ outcome: 'skipped' })
    expect(result.response.status).toBe(503)
    expect(body).toEqual({ skipped })
    expect(requests).toEqual([])
    expect(store.writes).toEqual([])
  })

  it.each([
    ['another schema', { ...SNAPSHOT, schema: 2 }, 'schema'],
    [
      'a negative count',
      {
        ...SNAPSHOT,
        releases: [{ tag: 'v1', assets: [{ id: 1, name: 'a', download_count: -1 }] }],
      },
      'releases',
    ],
    ['a package outside the scope', { ...SNAPSHOT, npm: [{ name: 'left-pad', days: [] }] }, 'npm'],
    ['malformed traffic', { ...SNAPSHOT, traffic: { views: [] } }, 'traffic'],
  ])('rejects a snapshot with %s', async (_label, snapshot, field) => {
    const { result } = await send(snapshotRequest(snapshot))
    expect(result).toMatchObject({ outcome: 'rejected', field })
    expect(result.response.status).toBe(400)
  })

  it('keeps the stored totals when PostHog fails, so the next run sends the deltas again', async () => {
    const store = new MemoryKeyValueStore()
    const { result } = await send(
      snapshotRequest(),
      store,
      {},
      () => new Response('', { status: 500 }),
    )

    expect(result).toMatchObject({ outcome: 'forward_failed' })
    expect(result.response.status).toBe(502)
    expect(store.writes).toEqual([])
  })

  it('stops on unreadable stored totals instead of counting every download again', async () => {
    const store = new MemoryKeyValueStore()
    await store.put(SNAPSHOT_STATE_KEY, '{"version":1}')
    const test = testDependencies()
    const env = environment({ STATS_SNAPSHOT_TOKEN: TOKEN, STATS_KV: store })
    const run = handleSnapshotRequest(routeContext(snapshotRequest(), env, test.dependencies))

    await expect(run).rejects.toThrow(EndpointError)
    expect(test.requests).toEqual([])
  })
})

describe('bearer token comparison', () => {
  it('matches only the exact token', async () => {
    expect(await bearerTokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(await bearerTokenMatches(`Bearer  ${TOKEN} `, TOKEN)).toBe(true)
    expect(await bearerTokenMatches(`Bearer ${TOKEN.slice(1)}`, TOKEN)).toBe(false)
    expect(await bearerTokenMatches(`bearer ${TOKEN}`, TOKEN)).toBe(false)
    expect(await bearerTokenMatches(null, TOKEN)).toBe(false)
    expect(await bearerTokenMatches('Bearer ', '')).toBe(false)
  })
})
