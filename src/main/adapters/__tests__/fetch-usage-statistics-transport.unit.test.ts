import type { UsageStatisticsRequest } from '@shared/usage-statistics/contract'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  classifyUsageStatisticsFailure,
  classifyUsageStatisticsResponse,
  createFetchUsageStatisticsTransport,
  USAGE_STATISTICS_EVENTS_URL,
  USAGE_STATISTICS_REQUEST_TIMEOUT_MS,
  type UsageStatisticsFetch,
} from '../fetch-usage-statistics-transport'

const REQUEST: UsageStatisticsRequest = {
  schema: 1,
  context: {
    version: '1.0.0',
    build_channel: 'stable',
    update_channel: 'stable',
    os: 'linux',
    arch: 'x64',
  },
  events: [{ name: 'app.opened', day: '2026-10-01', properties: {} }],
}

/** What Node's fetch throws: a TypeError whose cause is the system error. */
function fetchFailure(cause: unknown) {
  return new TypeError('fetch failed', { cause })
}

function systemError(code: string, syscall?: string) {
  return Object.assign(new Error(`${syscall ?? 'socket'} ${code} 203.0.113.9:443`), {
    code,
    ...(syscall ? { syscall } : {}),
  })
}

function failingWith(error: unknown): UsageStatisticsFetch {
  return async () => {
    throw error
  }
}

describe('fetch Usage statistics transport', () => {
  it('posts only the JSON batch to the OpenWaggle endpoint and releases the body', async () => {
    const sent: Parameters<UsageStatisticsFetch>[] = []
    let bodyReleased = false
    const transport = createFetchUsageStatisticsTransport({
      fetch: async (...call) => {
        sent.push(call)
        return {
          status: 202,
          body: {
            cancel: async () => {
              bodyReleased = true
            },
          },
        }
      },
    })

    const delivery = await Effect.runPromise(transport.send(REQUEST))

    expect(delivery).toEqual({ outcome: 'accepted', status: 202 })
    expect(USAGE_STATISTICS_EVENTS_URL).toBe('https://openwaggle.ai/api/v1/events')
    expect(sent).toHaveLength(1)
    const [url, init] = sent[0] ?? []
    expect(url).toBe(USAGE_STATISTICS_EVENTS_URL)
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init?.headers).toEqual({ 'content-type': 'application/json' })
    expect(JSON.parse(init?.body ?? '')).toEqual(REQUEST)
    expect(bodyReleased).toBe(true)
  })

  it('gives the endpoint 30 seconds and treats a timeout as an unknown outcome', async () => {
    expect(USAGE_STATISTICS_REQUEST_TIMEOUT_MS).toBe(30_000)

    const timedOut = await Effect.runPromise(
      createFetchUsageStatisticsTransport({
        timeoutMs: 1,
        fetch: (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason))
          }),
      }).send(REQUEST),
    )

    expect(timedOut).toEqual({ outcome: 'unknown', reason: 'TimeoutError' })
  })

  it.each([
    ['name resolution', fetchFailure(systemError('ENOTFOUND', 'getaddrinfo'))],
    ['a refused connection', fetchFailure(systemError('ECONNREFUSED', 'connect'))],
    ['an unreachable network', fetchFailure(systemError('ENETUNREACH', 'connect'))],
    [
      'a connect timeout',
      fetchFailure(
        Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }),
      ),
    ],
    [
      'every address failing to connect',
      fetchFailure(
        Object.assign(
          new AggregateError([
            systemError('ETIMEDOUT', 'connect'),
            systemError('ECONNREFUSED', 'connect'),
          ]),
          {
            code: 'ETIMEDOUT',
          },
        ),
      ),
    ],
  ])('retries after %s, because the request never left', async (_label, error) => {
    const delivery = await Effect.runPromise(
      createFetchUsageStatisticsTransport({ fetch: failingWith(error) }).send(REQUEST),
    )

    expect(delivery).toEqual({ outcome: 'retry', reason: 'not-connected' })
  })

  it.each([
    ['a reset connection', fetchFailure(systemError('ECONNRESET', 'read'))],
    ['a socket timeout after connecting', fetchFailure(systemError('ETIMEDOUT', 'read'))],
    ['a refused redirect', new TypeError('fetch failed')],
    ['something unexpected', new Error('boom')],
  ])('treats %s as an unknown outcome, never resent', (_label, error) => {
    expect(classifyUsageStatisticsFailure(error)).toMatchObject({ outcome: 'unknown' })
  })

  it('keeps addresses and messages out of the delivery it reports', async () => {
    const delivery = await Effect.runPromise(
      createFetchUsageStatisticsTransport({
        fetch: failingWith(fetchFailure(systemError('ECONNRESET', 'read'))),
      }).send(REQUEST),
    )

    expect(JSON.stringify(delivery)).not.toContain('203.0.113.9')
  })

  it.each([
    [200, 'accepted'],
    [202, 'accepted'],
    [400, 'rejected'],
    [408, 'rejected'],
    [413, 'rejected'],
    [429, 'retry'],
    [500, 'retry'],
    [502, 'retry'],
    [503, 'retry'],
  ] as const)('classifies HTTP %i as %s', (status, outcome) => {
    expect(classifyUsageStatisticsResponse(status).outcome).toBe(outcome)
  })
})
