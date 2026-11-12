import { describe, expect, it } from 'vitest'
import { handleErrorsRequest } from '../errors-route'
import { encodeUtf8, parseJsonBytes } from '../http'
import { parseSentryEnvelope } from '../sentry-envelope'
import {
  CLIENT_ADDRESS,
  environment,
  type RecordedRequest,
  type Responder,
  routeContext,
  statisticsRequest,
  testDependencies,
} from './test-support'

const PLACEHOLDER_DSN = 'https://openwaggle@openwaggle.ai/1'
const SENTRY_DSN = 'https://publickey@o42.ingest.de.sentry.io/4507'
const ENVELOPE_URL = 'https://o42.ingest.de.sentry.io/api/4507/envelope/'

const ERROR_EVENT = {
  event_id: 'b'.repeat(32),
  timestamp: 1_790_956_200,
  platform: 'node',
  level: 'error',
  release: 'openwaggle@1.0.0-beta.4',
  server_name: 'Alices-MacBook-Pro',
  user: { ip_address: CLIENT_ADDRESS, id: 'user-1' },
  request: {
    url: 'app://-/index.html#/sessions/4f2c',
    headers: { Cookie: 'a=b' },
    cookies: { a: 'b' },
  },
  breadcrumbs: [{ message: 'clicked send' }],
  modules: { electron: '43.2.0' },
  contexts: {
    os: { name: 'macOS', version: '14.6', kernel_version: '23.6.0' },
    device: {
      arch: 'arm64',
      name: 'Alices-MacBook-Pro',
      memory_size: 8,
      free_memory: 1,
      boot_time: 'x',
    },
    app: {
      app_version: '1.0.0-beta.4',
      app_start_time: 'x',
      app_name: 'OpenWaggle Dev (my-branch)',
    },
    culture: { locale: 'de-DE', timezone: 'Europe/Berlin' },
    runtime: { name: 'Electron', version: '43.2.0' },
    chrome: { name: 'Chrome', type: 'runtime', version: '140.0' },
    node: { name: 'Node', type: 'runtime', version: '24.1.0' },
    trace: { trace_id: 'c'.repeat(32), span_id: 'd'.repeat(16) },
  },
  exception: {
    values: [
      {
        type: 'Error',
        value: 'ENOENT: /Users/alice/Projects/secret/file.ts',
        stacktrace: {
          frames: [
            {
              filename: '/Users/alice/.openwaggle/app.js',
              function: 'run',
              lineno: 1,
              vars: { token: 'hunter2' },
              context_line: 'const secret = 1',
              pre_context: ['a'],
              post_context: ['b'],
            },
          ],
        },
      },
    ],
  },
  extra: { '/home/bob/notes': 'C:\\Users\\Bob Smith\\AppData\\x' },
}

const SESSION = {
  sid: 'e'.repeat(32),
  did: 'alice@example.com',
  attrs: { ip_address: CLIENT_ADDRESS },
}

function envelope(items: readonly { readonly header: object; readonly payload: string }[]) {
  const header = { event_id: 'b'.repeat(32), dsn: PLACEHOLDER_DSN, trace: { user_segment: 'vip' } }
  const lines = [JSON.stringify(header)]
  for (const item of items) lines.push(JSON.stringify(item.header), item.payload)
  return `${lines.join('\n')}\n`
}

const EVENT_ITEM = { header: { type: 'event' }, payload: JSON.stringify(ERROR_EVENT) }

const ENVELOPE_TYPE = { 'Content-Type': 'application/x-sentry-envelope' }

async function report(
  body: BodyInit,
  headers: Record<string, string> = {},
  overrides = {},
  respond: Responder = () => new Response('{"id":"b"}', { status: 200 }),
) {
  const test = testDependencies(respond)
  const request = statisticsRequest('/api/v1/errors', {
    body,
    headers: { ...ENVELOPE_TYPE, ...headers },
  })
  const env = environment({ SENTRY_DSN, ...overrides })
  const result = await handleErrorsRequest(routeContext(request, env, test.dependencies))
  return { ...test, result }
}

function forwarded(request: RecordedRequest | undefined) {
  if (typeof request?.init.body !== 'string') throw new Error('expected a forwarded envelope')
  const parsed = parseSentryEnvelope(encodeUtf8(request.init.body), 100)
  if (parsed === undefined) throw new Error('expected a valid envelope')
  return {
    header: parsed.header,
    items: parsed.items.map((item) => {
      const payload = parseJsonBytes(item.payload)
      return { type: item.header.type, payload: payload.ok ? payload.value : undefined }
    }),
  }
}

describe('POST /api/v1/errors', () => {
  it('forwards scrubbed events under the real DSN to the project envelope endpoint', async () => {
    const { result, requests } = await report(envelope([EVENT_ITEM]))

    expect(result).toMatchObject({ outcome: 'accepted', accepted: 1, rejected: 0 })
    expect(result.response.status).toBe(200)
    expect(requests.map(({ url }) => url)).toEqual([ENVELOPE_URL])
    expect(requests[0]?.init.headers).toEqual({ 'Content-Type': 'application/x-sentry-envelope' })
    const { header, items } = forwarded(requests[0])
    expect(header).toEqual({ event_id: 'b'.repeat(32), dsn: SENTRY_DSN })
    expect(items).toEqual([
      {
        type: 'event',
        payload: {
          event_id: 'b'.repeat(32),
          timestamp: 1_790_956_200,
          platform: 'node',
          level: 'error',
          release: 'openwaggle@1.0.0-beta.4',
          contexts: {
            os: { name: 'macOS', version: '14.6' },
            device: { arch: 'arm64' },
            app: { app_version: '1.0.0-beta.4' },
            runtime: { name: 'Electron', version: '43.2.0' },
            chrome: { type: 'runtime', name: 'Chrome', version: '140.0' },
            node: { type: 'runtime', name: 'Node', version: '24.1.0' },
          },
          exception: {
            values: [
              {
                type: 'Error',
                value: 'ENOENT',
                stacktrace: {
                  frames: [{ filename: '<external>', function: '<external>', lineno: 1 }],
                },
              },
            ],
          },
        },
      },
    ])
  })

  it('keeps the scrubbed message of a handled error the app reported itself', async () => {
    const handled = {
      ...ERROR_EVENT,
      tags: { 'openwaggle.error_origin': 'application', 'openwaggle.process': 'gui' },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Session 4f2c9a1e-5b6d-4c7e-8f90-123456789abc failed in /Users/alice/x',
            mechanism: { type: 'generic', handled: true },
          },
        ],
      },
    }
    const { requests } = await report(
      envelope([{ header: { type: 'event' }, payload: JSON.stringify(handled) }]),
    )
    const [item] = forwarded(requests[0]).items

    expect(item?.payload).toMatchObject({
      event_id: 'b'.repeat(32),
      exception: { values: [{ value: 'Session <id> failed in ~/x' }] },
      extra: { '~/notes': '~\\AppData\\x' },
    })
  })

  it('drops sessions, attachments and every other item type', async () => {
    const { result, requests } = await report(
      envelope([
        { header: { type: 'session' }, payload: JSON.stringify(SESSION) },
        EVENT_ITEM,
        { header: { type: 'attachment', filename: 'screenshot.png', length: 3 }, payload: 'PNG' },
        { header: { type: 'client_report' }, payload: '{"discarded_events":[]}' },
        { header: { type: 'event' }, payload: 'not json' },
      ]),
    )

    expect(result).toMatchObject({ outcome: 'accepted', accepted: 1, rejected: 4 })
    expect(forwarded(requests[0]).items.map(({ type }) => type)).toEqual(['event'])
    expect(requests[0]?.init.body).not.toContain(CLIENT_ADDRESS)
    expect(requests[0]?.init.body).not.toContain('alice@example.com')
  })

  it('reads an envelope the SDK gzipped', async () => {
    const stream = new Blob([envelope([EVENT_ITEM])])
      .stream()
      .pipeThrough(new CompressionStream('gzip'))
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
    const { result, requests } = await report(compressed, { 'Content-Encoding': 'gzip' })

    expect(result.outcome).toBe('accepted')
    expect(forwarded(requests[0]).items).toHaveLength(1)
  })

  it.each([
    ['a web page Origin', { Origin: 'https://evil.example' }, 403, 'origin'],
    ['a local web page Origin', { Origin: 'http://127.0.0.1:5173' }, 403, 'origin'],
    ['another content type', { 'Content-Type': 'text/plain;charset=UTF-8' }, 415, 'content_type'],
  ])('turns away a request with %s', async (_label, headers, status, field) => {
    const { result, requests } = await report(envelope([EVENT_ITEM]), headers)

    expect(result).toMatchObject({ outcome: 'rejected', field })
    expect(result.response.status).toBe(status)
    expect(requests).toEqual([])
  })

  it.each([['null'], ['file://'], ['app://-']])(
    'forwards a report whose Origin %s names no web page',
    async (origin) => {
      const { result } = await report(envelope([EVENT_ITEM]), { Origin: origin })
      expect(result.outcome).toBe('accepted')
    },
  )

  it('accepts and drops reports while SENTRY_DSN is unset', async () => {
    const { result, requests } = await report(envelope([EVENT_ITEM]), {}, { SENTRY_DSN: ' ' })

    expect(result).toMatchObject({ outcome: 'skipped' })
    expect(result.response.status).toBe(204)
    expect(requests).toEqual([])
  })

  it.each([
    ['not an https DSN', 'http://x@o1.ingest.de.sentry.io/1'],
    ['a project outside the EU region', 'https://key@o42.ingest.us.sentry.io/4507'],
    ['a host that only contains the EU name', 'https://key@de.sentry.io.evil.example/4507'],
  ])('drops reports when SENTRY_DSN is %s', async (_label, dsn) => {
    const { result, requests } = await report(envelope([EVENT_ITEM]), {}, { SENTRY_DSN: dsn })

    expect(result.response.status).toBe(503)
    expect(result.outcome).toBe('skipped')
    expect(requests).toEqual([])
  })

  it('answers 202 without forwarding an envelope with nothing to forward', async () => {
    const { result, requests } = await report(
      envelope([{ header: { type: 'session' }, payload: JSON.stringify(SESSION) }]),
    )

    expect(result).toMatchObject({ outcome: 'skipped', accepted: 0, rejected: 1 })
    expect(result.response.status).toBe(202)
    expect(requests).toEqual([])
  })

  it.each([
    ['an unsupported encoding', envelope([EVENT_ITEM]), { 'Content-Encoding': 'br' }, 415],
    ['a malformed header', 'not json\n{}\n', {}, 400],
    ['a payload shorter than its length', `{}\n{"type":"event","length":99}\n{}\n`, {}, 400],
    ['a body over 1 MiB', `{}\n${'x'.repeat(1_048_577)}`, {}, 413],
    ['a corrupt gzip body', 'definitely not gzip', { 'Content-Encoding': 'gzip' }, 400],
  ])('rejects %s', async (_label, body, headers, status) => {
    const { result, requests } = await report(body, headers)

    expect(result).toMatchObject({ outcome: 'rejected', field: 'envelope' })
    expect(result.response.status).toBe(status)
    expect(requests).toEqual([])
  })

  it("relays Sentry's rate limit so the SDK backs off", async () => {
    const { result } = await report(
      envelope([EVENT_ITEM]),
      {},
      {},
      () =>
        new Response('', {
          status: 429,
          headers: {
            'Retry-After': '60',
            'X-Sentry-Rate-Limits': '60:error:organization',
            'Set-Cookie': 'x=y',
          },
        }),
    )

    expect(result).toMatchObject({ outcome: 'forward_failed', accepted: 0 })
    expect(result.response.status).toBe(429)
    expect(result.response.headers.get('Retry-After')).toBe('60')
    expect(result.response.headers.get('X-Sentry-Rate-Limits')).toBe('60:error:organization')
    expect(result.response.headers.get('Set-Cookie')).toBeNull()
  })

  it('reports an unreachable Sentry as forward_failed', async () => {
    const { result } = await report(envelope([EVENT_ITEM]), {}, {}, () =>
      Promise.reject(new TypeError('network down')),
    )

    expect(result.outcome).toBe('forward_failed')
    expect(result.response.status).toBe(502)
  })
})
