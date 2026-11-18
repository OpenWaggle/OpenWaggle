import { describe, expect, it } from 'vitest'
import { publishedFieldName, UNPUBLISHED_FIELD } from '../events-route'
import { ACTIVE_DAY, onlyEntry, requestRows, send } from './events-test-support'
import {
  bufferExpiry,
  CONTEXT,
  eventsBody,
  MemoryKeyValueStore,
  runFinished,
  testUuid,
  YESTERDAY,
} from './test-support'

describe('POST /api/v1/events', () => {
  it('stores one buffer entry of counts and forwards nothing', async () => {
    const { result, response, store, requests } = await send(
      eventsBody([
        {
          name: 'update.installed',
          day: YESTERDAY,
          properties: { previous_version: '1.0.0-beta.3' },
        },
      ]),
    )

    expect(result).toMatchObject({ outcome: 'accepted', accepted: 1, rejected: 0 })
    expect(result.response.status).toBe(202)
    expect(response).toEqual({ accepted: 1, rejected: 0 })
    expect(requests).toEqual([])
    const { key, options, entry } = onlyEntry(store)
    expect(key).toBe(`buf:${YESTERDAY}:${testUuid(1)}`)
    expect(options).toEqual({ expiration: bufferExpiry(YESTERDAY) })
    expect(entry).toEqual({
      v: 1,
      day: YESTERDAY,
      c: [
        ['update.installed', '_count', '1', 1],
        ['update.installed', 'version', CONTEXT.version, 1],
        ['update.installed', 'build_channel', 'beta', 1],
        ['update.installed', 'update_channel', 'beta', 1],
        ['update.installed', 'os', 'darwin', 1],
        ['update.installed', 'arch', 'arm64', 1],
        ['update.installed', 'country', 'DE', 1],
        ['update.installed', 'previous_version', '1.0.0-beta.3', 1],
        ...requestRows('accepted', 202),
      ],
      s: [
        ['endpoint.requests', 'accepted', 1, 1],
        ['endpoint.requests', 'rejected', 0, 1],
      ],
    })
  })

  it('adds a request up: booleans as text, list items alone, entry points as one value, integers as sums', async () => {
    const { store } = await send(
      eventsBody([
        ACTIVE_DAY,
        runFinished({ duration_s: 10, input_tokens: 100, output_tokens: 20 }),
        runFinished({ duration_s: 30, input_tokens: 300, output_tokens: 40, waggle: true }),
      ]),
    )
    const { entry } = onlyEntry(store)

    expect(entry.c).toEqual(
      expect.arrayContaining([
        ['install.active', '_count', '1', 1],
        ['install.active', 'first_this_week', 'true', 1],
        ['install.active', 'first_this_month', 'false', 1],
        ['install.active', 'entry_points', 'app+cli', 1],
        ['install.active', 'worktree', 'true', 1],
        ['install.active', 'mcp_servers', 'playwright', 1],
        ['install.active', 'skills', 'visualize', 1],
        ['run.finished', '_count', '1', 2],
        ['run.finished', 'os', 'darwin', 2],
        ['run.finished', 'country', 'DE', 2],
        ['run.finished', 'provider', 'anthropic', 2],
        ['run.finished', 'model', 'claude-sonnet-4-5', 2],
        ['run.finished', 'waggle', 'false', 1],
        ['run.finished', 'waggle', 'true', 1],
      ]),
    )
    expect(entry.s).toEqual([
      ['run.finished', 'duration_s', 40, 2],
      ['run.finished', 'input_tokens', 400, 2],
      ['run.finished', 'output_tokens', 60, 2],
      ['endpoint.requests', 'accepted', 3, 1],
      ['endpoint.requests', 'rejected', 0, 1],
    ])
    expect(entry.c.some(([, field]: string[]) => field === 'duration_s')).toBe(false)
  })

  it('records entry points as one combination per day, in contract order', async () => {
    const { store } = await send(
      eventsBody([
        { ...ACTIVE_DAY, properties: { ...ACTIVE_DAY.properties, entry_points: ['agent', 'app'] } },
      ]),
    )
    const rows = onlyEntry(store).entry.c.filter(([, field]: string[]) => field === 'entry_points')

    expect(rows).toEqual([['install.active', 'entry_points', 'app+agent', 1]])
  })

  it('turns providers, models, MCP servers and skills outside the catalog into custom', async () => {
    const { store } = await send(
      eventsBody([
        runFinished({ provider: 'alice-private-ollama', model: 'acme-secret-finetune-v3' }),
        runFinished({ provider: 'anthropic', model: 'acme-secret-finetune-v3' }),
        {
          ...ACTIVE_DAY,
          properties: {
            ...ACTIVE_DAY.properties,
            mcp_servers: ['playwright', 'my-private-server', 'another-private-server'],
            skills: ['secret-skill', 'visualize'],
          },
        },
      ]),
    )
    const { entry } = onlyEntry(store)

    expect(entry.c).toEqual(
      expect.arrayContaining([
        ['run.finished', 'provider', 'custom', 1],
        ['run.finished', 'provider', 'anthropic', 1],
        ['run.finished', 'model', 'custom', 2],
        ['install.active', 'mcp_servers', 'custom', 1],
        ['install.active', 'mcp_servers', 'playwright', 1],
        ['install.active', 'skills', 'custom', 1],
        ['install.active', 'skills', 'visualize', 1],
      ]),
    )
    const stored = JSON.stringify(entry)
    for (const privateName of [
      'alice-private-ollama',
      'acme-secret-finetune-v3',
      'my-private-server',
      'secret-skill',
    ]) {
      expect(stored).not.toContain(privateName)
    }
  })

  it('drops and counts invalid events, naming only a published field', async () => {
    const { result, response, store } = await send(
      eventsBody([runFinished(), runFinished({ prompt: 'my secret prompt' })]),
    )
    const { entry } = onlyEntry(store)

    expect(result).toMatchObject({
      outcome: 'accepted',
      accepted: 1,
      rejected: 1,
      field: UNPUBLISHED_FIELD,
    })
    expect(response).toEqual({ accepted: 1, rejected: 1 })
    expect(entry.c).toEqual(
      expect.arrayContaining([
        ['run.finished', '_count', '1', 1],
        ['endpoint.requests', 'field', UNPUBLISHED_FIELD, 1],
      ]),
    )
    expect(entry.s).toContainEqual(['endpoint.requests', 'rejected', 1, 1])
    expect(JSON.stringify(entry)).not.toContain('my secret prompt')
  })

  it('stores nothing for a request without an accepted event', async () => {
    const store = new MemoryKeyValueStore()
    const { result, response } = await send(
      eventsBody([runFinished({ result: 'exploded' }), runFinished({ duration_s: -1 })]),
      { store },
    )

    expect(result).toMatchObject({ outcome: 'rejected', accepted: 0, rejected: 2, field: 'result' })
    expect(result.response.status).toBe(202)
    expect(response).toEqual({ accepted: 0, rejected: 2 })
    expect(store.writes).toEqual([])
  })

  it('stores nothing for an empty request', async () => {
    const store = new MemoryKeyValueStore()
    const { result, response } = await send(eventsBody([]), { store })

    expect(result).toMatchObject({ outcome: 'skipped', accepted: 0, rejected: 0 })
    expect(response).toEqual({ accepted: 0, rejected: 0 })
    expect(store.writes).toEqual([])
  })

  it('expires an entry a fixed time after its day, whenever it arrived', async () => {
    const earlier = '2026-09-20'
    const { store } = await send(eventsBody([runFinished({}, earlier)]))
    expect(onlyEntry(store).options).toEqual({ expiration: bufferExpiry(earlier) })
  })
})

describe('published field names', () => {
  it('passes contract field names and replaces anything else', () => {
    expect(publishedFieldName('provider')).toBe('provider')
    expect(publishedFieldName('build_channel')).toBe('build_channel')
    expect(publishedFieldName('content_type')).toBe('content_type')
    expect(publishedFieldName('alice@example.com')).toBe(UNPUBLISHED_FIELD)
  })
})
