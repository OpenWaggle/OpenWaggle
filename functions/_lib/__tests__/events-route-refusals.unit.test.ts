import { describe, expect, it } from 'vitest'
import { ACTIVE_DAY, onlyEntry, send } from './events-test-support'
import {
  CLIENT_ADDRESS,
  CONTEXT,
  eventsBody,
  failingStore,
  MemoryKeyValueStore,
  runFinished,
  TODAY,
  YESTERDAY,
} from './test-support'

async function refused(body: BodyInit, options = {}) {
  const store = new MemoryKeyValueStore()
  const sent = await send(body, { ...options, store })
  return { ...sent, store }
}

describe('POST /api/v1/events refusals', () => {
  it.each([
    ['events of two days', [runFinished(), runFinished({}, TODAY)], 'day'],
    ['two install.active events', [ACTIVE_DAY, ACTIVE_DAY], 'events'],
    [
      'more than 20 app.opened events',
      Array.from({ length: 21 }, () => ({ name: 'app.opened', day: YESTERDAY, properties: {} })),
      'events',
    ],
    [
      'more than 150 run events',
      [
        ...Array.from({ length: 100 }, () => runFinished()),
        ...Array.from({ length: 51 }, () => ({
          name: 'run.compacted',
          day: YESTERDAY,
          properties: { mechanism: 'native' },
        })),
      ],
      'events',
    ],
  ])('refuses %s whole and stores nothing', async (_label, events, field) => {
    const { result, store } = await refused(eventsBody(events))

    expect(result).toMatchObject({
      outcome: 'rejected',
      accepted: 0,
      rejected: events.length,
      field,
    })
    expect(result.response.status).toBe(400)
    expect(store.writes).toEqual([])
  })

  it.each([
    [
      'an unknown top-level field',
      JSON.stringify({ schema: 1, context: CONTEXT, events: [], x: 1 }),
      400,
      'request',
    ],
    [
      'another schema version',
      JSON.stringify({ schema: 2, context: CONTEXT, events: [] }),
      400,
      'schema',
    ],
    [
      'events that are not a list',
      JSON.stringify({ schema: 1, context: CONTEXT, events: {} }),
      400,
      'events',
    ],
    ['more than 200 events', eventsBody(Array.from({ length: 201 }, () => ({}))), 413, 'events'],
    [
      'an unpublished operating system',
      eventsBody([runFinished()], { ...CONTEXT, os: 'freebsd' }),
      400,
      'os',
    ],
  ])('rejects %s and stores nothing', async (_label, body, status, field) => {
    const { result, store } = await refused(body)

    expect(result).toMatchObject({ outcome: 'rejected', field })
    expect(result.response.status).toBe(status)
    expect(store.writes).toEqual([])
  })

  it.each([
    ['a web page Origin', { headers: { Origin: 'https://evil.example' } }, 403, 'origin'],
    ['a local web page Origin', { headers: { Origin: 'http://localhost:4321' } }, 403, 'origin'],
    ['an opaque null Origin', { headers: { Origin: 'null' } }, 403, 'origin'],
    ['a text/plain body', { headers: { 'Content-Type': 'text/plain' } }, 415, 'content_type'],
    ['form data', { headers: { 'Content-Type': 'multipart/form-data' } }, 415, 'content_type'],
  ])('turns away %s without storing anything', async (_label, options, status, field) => {
    const { result, store } = await refused(eventsBody([runFinished()]), options)

    expect(result).toMatchObject({ outcome: 'rejected', field })
    expect(result.response.status).toBe(status)
    expect(store.writes).toEqual([])
  })

  it.each([
    ['a file Origin', 'file://'],
    ['an app Origin', 'app://-'],
  ])('accepts %s, which no browser sends', async (_label, origin) => {
    const { result } = await send(eventsBody([runFinished()]), { headers: { Origin: origin } })
    expect(result.outcome).toBe('accepted')
  })

  it('accepts a JSON content type with parameters', async () => {
    const { result } = await send(eventsBody([runFinished()]), {
      headers: { 'Content-Type': 'Application/JSON; charset=utf-8' },
    })
    expect(result.outcome).toBe('accepted')
  })

  it.each([
    ['a body over 256 KiB', 'x'.repeat(262_145), 413],
    ['a body that is not JSON', '{', 400],
    ['a JSON value that is not an object', '[]', 400],
  ])('rejects %s without storing anything', async (_label, body, status) => {
    const { result, store } = await refused(body)

    expect(result).toMatchObject({ outcome: 'rejected', field: 'body' })
    expect(result.response.status).toBe(status)
    expect(store.writes).toEqual([])
  })

  it('answers 503 without the STATS_KV binding, so the app retries later', async () => {
    const { result } = await send(eventsBody([runFinished()]), { env: { STATS_KV: undefined } })
    expect(result).toMatchObject({ outcome: 'skipped' })
    expect(result.response.status).toBe(503)
  })

  it('answers 503 and stores nothing when the entry cannot be stored', async () => {
    const { result, response } = await send(eventsBody([runFinished()]), { store: failingStore() })

    expect(result).toMatchObject({ outcome: 'forward_failed', accepted: 0, rejected: 0 })
    expect(result.response.status).toBe(503)
    expect(response).toEqual({ error: 'storage failed' })
  })

  it('still answers a rejection when its request count cannot be stored', async () => {
    const { result } = await send(eventsBody([ACTIVE_DAY, ACTIVE_DAY]), { store: failingStore() })
    expect(result.response.status).toBe(400)
  })

  it.each([
    ['a Tor exit', { country: 'T1' }],
    ['no Cloudflare metadata', undefined],
  ])('files %s under the unknown country', async (_label, cf) => {
    const { store } = await send(eventsBody([runFinished()]), { cf })
    expect(onlyEntry(store).entry.c).toContainEqual(['run.finished', 'country', 'XX', 1])
  })

  it('keeps no request header, address or cookie in the entry', async () => {
    const { store } = await send(eventsBody([runFinished()]), {
      headers: {
        'CF-Connecting-IP': CLIENT_ADDRESS,
        Cookie: 'session=abc',
        'User-Agent': 'Secret-Agent/1.0',
      },
    })
    const stored = JSON.stringify(onlyEntry(store))

    expect(stored).not.toContain(CLIENT_ADDRESS)
    expect(stored).not.toContain('session=abc')
    expect(stored).not.toContain('Secret-Agent')
  })
})
