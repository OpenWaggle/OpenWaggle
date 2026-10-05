import { describe, expect, it } from 'vitest'
import type { KeyValueStore } from '../cloudflare'
import { encodeUtf8 } from '../http'
import { dailySalt, hexEncode, IsolateSalts, saltExpiry, WEB_SALT_KEY_PREFIX } from '../visitor-key'
import { handleWebRequest } from '../web-route'
import {
  BROWSER_USER_AGENT,
  CLIENT_ADDRESS,
  environment,
  failingStore,
  MemoryKeyValueStore,
  NOW,
  PERSONLESS,
  postHogBatch,
  routeContext,
  statisticsRequest,
  TODAY,
  testDependencies,
} from './test-support'

const SALT = '07'.repeat(32)

function beaconRequest(beacon: unknown, headers: Record<string, string> = {}, origin?: string) {
  return statisticsRequest('/api/v1/web', {
    body: JSON.stringify(beacon),
    headers: {
      Origin: 'https://openwaggle.ai',
      'User-Agent': BROWSER_USER_AGENT,
      'CF-Connecting-IP': CLIENT_ADDRESS,
      ...headers,
    },
    cf: { country: 'FR' },
    ...(origin === undefined ? {} : { origin }),
  })
}

const PAGEVIEW = {
  type: 'pageview',
  path: '/docs/getting-started/installation/',
  referrer: 'https://www.google.com',
  utm_source: 'newsletter',
}

async function expectedVisitor(salt: string, userAgent = BROWSER_USER_AGENT) {
  const material = [salt, CLIENT_ADDRESS, userAgent, 'openwaggle.ai'].join('\n')
  return hexEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', encodeUtf8(material))))
}

async function send(
  request: Request,
  store: KeyValueStore = new MemoryKeyValueStore(),
  overrides = {},
) {
  const test = testDependencies()
  const env = environment({ STATS_KV: store, ...overrides })
  const result = await handleWebRequest(routeContext(request, env, test.dependencies))
  return { ...test, result, store }
}

function memory(store: KeyValueStore) {
  if (!(store instanceof MemoryKeyValueStore)) throw new Error('expected a memory store')
  return store
}

const DAY = 86_400_000

describe('POST /api/v1/web', () => {
  it('forwards a page view under the daily visitor key, without the address or User-Agent', async () => {
    const { result, requests, store } = await send(beaconRequest(PAGEVIEW))

    expect(result).toEqual({
      response: expect.any(Response),
      outcome: 'accepted',
      accounted: true,
    })
    expect(result.response.status).toBe(204)
    expect(memory(store).entries.get(`${WEB_SALT_KEY_PREFIX}${TODAY}`)).toEqual({
      value: SALT,
      options: { expiration: Date.parse('2026-10-03T00:00:00Z') / 1000 },
    })
    expect(requests).toHaveLength(1)
    const [event, accounting] = postHogBatch(requests[0]).events
    expect(accounting).toEqual({
      event: 'endpoint.request',
      timestamp: new Date(NOW).toISOString(),
      properties: {
        ...PERSONLESS,
        path: '/api/v1/web',
        outcome: 'accepted',
        status: 204,
        latency_ms: 0,
      },
    })
    expect(event).toEqual({
      event: '$pageview',
      timestamp: new Date(NOW).toISOString(),
      properties: {
        distinct_id: await expectedVisitor(SALT),
        $process_person_profile: false,
        $geoip_disable: true,
        $lib: 'openwaggle-statistics-endpoint',
        $lib_version: '1',
        $current_url: 'https://openwaggle.ai/docs/getting-started/installation/',
        $host: 'openwaggle.ai',
        $pathname: '/docs/getting-started/installation/',
        $referrer: 'https://www.google.com',
        $referring_domain: 'www.google.com',
        traffic_channel: 'search',
        utm_source: 'newsletter',
        country: 'FR',
      },
    })
    const forwarded = JSON.stringify(requests)
    expect(forwarded).not.toContain(CLIENT_ADDRESS)
    expect(forwarded).not.toContain(BROWSER_USER_AGENT)
    expect(forwarded).not.toContain(SALT)
  })

  it('reuses the day salt, so one visitor keeps one key that day', async () => {
    const store = new MemoryKeyValueStore()
    await store.put(`${WEB_SALT_KEY_PREFIX}${TODAY}`, 'existing-salt')
    const first = await send(beaconRequest(PAGEVIEW), store)
    const click = { type: 'download_click', path: '/', referrer: '', target: 'github_releases' }
    const second = await send(beaconRequest(click), store)

    const [view] = postHogBatch(first.requests[0]).events
    const [download] = postHogBatch(second.requests[0]).events
    expect(view.properties.distinct_id).toBe(await expectedVisitor('existing-salt'))
    expect(download.properties.distinct_id).toBe(view.properties.distinct_id)
    expect(download).toMatchObject({
      event: 'download_click',
      properties: { target: 'github_releases', $referrer: '$direct', traffic_channel: 'direct' },
    })
    expect(store.writes).toEqual([`${WEB_SALT_KEY_PREFIX}${TODAY}`])
  })

  it('marks a referrer on openwaggle.ai as internal, with no channel', async () => {
    const { requests } = await send(
      beaconRequest({ ...PAGEVIEW, referrer: 'https://openwaggle.ai' }),
    )
    const [event] = postHogBatch(requests[0]).events

    expect(event.properties).toMatchObject({ $referring_domain: 'openwaggle.ai' })
    expect(event.properties).not.toHaveProperty('traffic_channel')
  })

  it.each([
    ['another site', { Origin: 'https://evil.example' }],
    ['a preview deployment', { Origin: 'https://abc.openwaggle.pages.dev' }],
    ['a loopback page calling production', { Origin: 'http://localhost:4321' }],
    ['an opaque origin', { Origin: 'null' }],
  ])('refuses a beacon from %s', async (_label, headers) => {
    const { result, requests } = await send(beaconRequest(PAGEVIEW, headers))

    expect(result).toMatchObject({ outcome: 'rejected', field: 'origin' })
    expect(result.response.status).toBe(403)
    expect(requests).toEqual([])
  })

  it('refuses a beacon without an Origin header', async () => {
    const request = statisticsRequest('/api/v1/web', { body: JSON.stringify(PAGEVIEW) })
    const { result } = await send(request)
    expect(result).toMatchObject({ outcome: 'rejected', field: 'origin' })
  })

  it('accepts a loopback page when the endpoint runs on loopback', async () => {
    const request = beaconRequest(
      PAGEVIEW,
      { Origin: 'http://localhost:8788' },
      'http://localhost:8788',
    )
    const { result, requests } = await send(request)

    expect(result.outcome).toBe('accepted')
    expect(postHogBatch(requests[0]).events[0].properties.$current_url).toBe(
      'http://localhost:8788/docs/getting-started/installation/',
    )
  })

  it.each([
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    [
      'a headless browser',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 HeadlessChrome/140.0 Safari/537.36',
    ],
    ['curl', 'curl/8.7.1'],
    ['an empty User-Agent', ''],
  ])('drops %s without counting it', async (_label, userAgent) => {
    const { result, requests, store } = await send(
      beaconRequest(PAGEVIEW, { 'User-Agent': userAgent }),
    )

    expect(result).toMatchObject({ outcome: 'skipped' })
    expect(result.response.status).toBe(204)
    expect(requests).toEqual([])
    expect(memory(store).writes).toEqual([])
  })

  it.each([['Sec-GPC'], ['DNT']])('drops a beacon that carries %s: 1', async (header) => {
    const { result, requests } = await send(beaconRequest(PAGEVIEW, { [header]: '1' }))

    expect(result.outcome).toBe('skipped')
    expect(requests).toEqual([])
  })

  it.each([
    ['an unknown type', { ...PAGEVIEW, type: 'scroll' }, 'type'],
    ['a page view with a target', { ...PAGEVIEW, target: 'github_releases' }, 'target'],
    ['a click without a target', { ...PAGEVIEW, type: 'download_click' }, 'target'],
    [
      'an unpublished target',
      { ...PAGEVIEW, type: 'download_click', target: 'https://x' },
      'target',
    ],
    ['a path with a query', { ...PAGEVIEW, path: '/docs/?email=a@b.c' }, 'path'],
    ['a referrer that is not a URL', { ...PAGEVIEW, referrer: 'javascript:alert(1)' }, 'referrer'],
    ['an extra field', { ...PAGEVIEW, screen: '1920x1080' }, 'beacon'],
    ['an over-long UTM tag', { ...PAGEVIEW, utm_campaign: 'x'.repeat(129) }, 'utm_campaign'],
  ])('rejects %s', async (_label, beacon, field) => {
    const { result, requests } = await send(beaconRequest(beacon))

    expect(result).toMatchObject({ outcome: 'rejected', field })
    expect(result.response.status).toBe(400)
    expect(requests).toEqual([])
  })

  it('rejects a body over 4 KiB', async () => {
    const { result } = await send(beaconRequest({ ...PAGEVIEW, path: `/${'a'.repeat(5000)}` }))
    expect(result).toMatchObject({ outcome: 'rejected', field: 'beacon' })
    expect(result.response.status).toBe(413)
  })

  it('drops beacons while PostHog or the KV binding is missing, or PostHog is not the EU', async () => {
    const withoutKey = await send(beaconRequest(PAGEVIEW), undefined, {
      POSTHOG_PROJECT_KEY: undefined,
    })
    const withoutStore = await send(beaconRequest(PAGEVIEW), undefined, { STATS_KV: undefined })
    const elsewhere = await send(beaconRequest(PAGEVIEW), undefined, {
      POSTHOG_HOST: 'https://us.i.posthog.com',
    })

    expect(withoutKey.result).toMatchObject({ outcome: 'skipped' })
    expect(withoutKey.result.response.status).toBe(202)
    expect(withoutStore.result).toMatchObject({ outcome: 'skipped' })
    expect(withoutStore.result.response.status).toBe(503)
    expect(elsewhere.result.response.status).toBe(503)
    expect([...withoutKey.requests, ...withoutStore.requests, ...elsewhere.requests]).toEqual([])
  })

  it('still counts a page view while KV is down', async () => {
    const { result, requests } = await send(beaconRequest(PAGEVIEW), failingStore())

    expect(result.outcome).toBe('accepted')
    expect(postHogBatch(requests[0]).events[0].properties.distinct_id).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('answers 502 when PostHog refuses the batch', async () => {
    const test = testDependencies(() => new Response('', { status: 500 }))
    const env = environment({ STATS_KV: new MemoryKeyValueStore() })
    const result = await handleWebRequest(
      routeContext(beaconRequest(PAGEVIEW), env, test.dependencies),
    )

    expect(result).toMatchObject({ outcome: 'forward_failed', accounted: true })
    expect(result.response.status).toBe(502)
  })
})

describe('daily salt', () => {
  const sevens = (length: number) => new Uint8Array(length).fill(7)
  const nines = (length: number) => new Uint8Array(length).fill(9)

  it("keeps this isolate's own salt for the day while KV fails, and a new one the next day", async () => {
    const salts = new IsolateSalts()

    expect(await dailySalt(failingStore(), NOW, sevens, salts)).toBe(SALT)
    expect(await dailySalt(failingStore(), NOW + 1000, nines, salts)).toBe(SALT)
    expect(await dailySalt(failingStore(), NOW + DAY, nines, salts)).toBe('09'.repeat(32))
  })

  it('takes the salt another request wrote when its own write is refused', async () => {
    const reads = ['', 'salt-from-another-isolate']
    const store: KeyValueStore = {
      get: async () => reads.shift() ?? null,
      put: () => Promise.reject(new Error('429 Too Many Requests')),
      delete: () => Promise.resolve(),
      list: () => Promise.resolve({ keys: [], list_complete: true }),
    }

    expect(await dailySalt(store, NOW, sevens, new IsolateSalts())).toBe(
      'salt-from-another-isolate',
    )
  })

  it('falls back to the salt it created when KV keeps neither', async () => {
    const store: KeyValueStore = {
      get: async () => null,
      put: () => Promise.reject(new Error('KV write failed')),
      delete: () => Promise.resolve(),
      list: () => Promise.resolve({ keys: [], list_complete: true }),
    }
    const salts = new IsolateSalts()

    expect(await dailySalt(store, NOW, sevens, salts)).toBe(SALT)
    expect(await dailySalt(failingStore(), NOW, nines, salts)).toBe(SALT)
  })
})

describe('daily salt expiry', () => {
  it('ends with its UTC day', () => {
    expect(saltExpiry(Date.parse('2026-10-02T00:00:01Z'))).toBe(
      Date.parse('2026-10-03T00:00:00Z') / 1000,
    )
    expect(saltExpiry(Date.parse('2026-10-02T23:58:00Z'))).toBe(
      Date.parse('2026-10-03T00:00:00Z') / 1000,
    )
  })

  it("keeps KV's one-minute minimum just before midnight", () => {
    const now = Date.parse('2026-10-02T23:59:30Z')
    expect(saltExpiry(now)).toBe(now / 1000 + 60)
  })
})
