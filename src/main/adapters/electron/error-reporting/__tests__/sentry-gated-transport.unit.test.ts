import {
  createEnvelope,
  createStackParser,
  type Envelope,
  makeSession,
  ServerRuntimeClient,
} from '@sentry/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const delivered = vi.hoisted(() => {
  const bodies: string[] = []
  return { bodies }
})

/** The real SDK transport, with the network request replaced by a recorder. */
vi.mock('@sentry/electron/main', async () => {
  const core = await import('@sentry/core')
  return {
    makeElectronTransport: (options: Parameters<typeof core.createTransport>[0]) =>
      core.createTransport(options, async (request) => {
        delivered.bodies.push(
          typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body),
        )
        return { statusCode: 200 }
      }),
  }
})

import { makeElectronTransport } from '@sentry/electron/main'
import { createGatedElectronTransport } from '../sentry-gated-transport'

const FLUSH_TIMEOUT_MS = 1_000

/** The item types of a serialized envelope: its lines are a header, then item header, payload. */
function itemTypes(body: string) {
  return body
    .split('\n')
    .filter((_line, index) => index % 2 === 1)
    .map((line) => {
      const header: unknown = JSON.parse(line)
      return typeof header === 'object' && header !== null && 'type' in header
        ? header.type
        : undefined
    })
}

type ClientOptions = ConstructorParameters<typeof ServerRuntimeClient>[0]

function createClient(
  transport: ClientOptions['transport'],
  beforeSend?: ClientOptions['beforeSend'],
) {
  return new ServerRuntimeClient({
    dsn: 'https://openwaggle@openwaggle.ai/1',
    tunnel: 'https://openwaggle.ai/api/v1/errors',
    integrations: [],
    stackParser: createStackParser(),
    sendClientReports: false,
    transport,
    ...(beforeSend ? { beforeSend } : {}),
  })
}

const acceptEveryEvent = () => true

async function sendEveryKind(client: ServerRuntimeClient) {
  client.captureException(new Error('boom'))
  client.captureSession(makeSession({ release: 'openwaggle@1.0.0' }))
  client.captureEvent({ type: 'feedback', contexts: { feedback: { message: 'Great app' } } })
  void client.sendEnvelope(logEnvelope())
  await client.flush(FLUSH_TIMEOUT_MS)
}

function logEnvelope(): Envelope {
  return createEnvelope({}, [
    [
      { type: 'log', item_count: 1, content_type: 'application/vnd.sentry.items.log+json' },
      { items: [{ level: 'info', body: 'a log line', timestamp: 1 }] },
    ],
  ])
}

describe('gated Electron transport with the Sentry client', () => {
  beforeEach(() => {
    delivered.bodies.length = 0
  })

  it('reaches the transport with error, session, feedback and log envelopes', async () => {
    await sendEveryKind(createClient(makeElectronTransport))

    expect(delivered.bodies.map(itemTypes)).toEqual([['event'], ['session'], ['feedback'], ['log']])
  })

  it('delivers error events and drops session, feedback and log envelopes', async () => {
    await sendEveryKind(createClient(createGatedElectronTransport(() => true, acceptEveryEvent)))

    expect(delivered.bodies.map(itemTypes)).toEqual([['event']])
  })

  it('delivers only events that went through beforeSend, never a hand-made envelope', async () => {
    const scrubbed = new WeakSet<object>()
    const client = createClient(
      createGatedElectronTransport(
        () => true,
        (event) => typeof event === 'object' && event !== null && scrubbed.has(event),
      ),
      (event) => {
        scrubbed.add(event)
        return event
      },
    )

    client.captureException(new Error('boom'))
    void client.sendEnvelope(
      createEnvelope({}, [[{ type: 'event' }, { event_id: 'a', message: 'hand-made report' }]]),
    )
    await client.flush(FLUSH_TIMEOUT_MS)

    expect(delivered.bodies).toHaveLength(1)
    expect(delivered.bodies[0]).not.toContain('hand-made report')
  })

  it('delivers nothing while Usage statistics are off', async () => {
    await sendEveryKind(createClient(createGatedElectronTransport(() => false, acceptEveryEvent)))

    expect(delivered.bodies).toEqual([])
  })
})
