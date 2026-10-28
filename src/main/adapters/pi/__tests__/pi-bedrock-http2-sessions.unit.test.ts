import { createServer as createHttp2Server } from 'node:http2'
import type { AddressInfo } from 'node:net'
import type { Context } from '@earendil-works/pi-ai'
import { stream as streamBedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import { clearBedrockClients } from '@earendil-works/pi-ai/bedrock-provider'
import { AMAZON_BEDROCK_MODELS } from '@earendil-works/pi-ai/providers/amazon-bedrock.models'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BEDROCK_TEXT_FRAMES as TEXT_FRAMES } from './bedrock-event-stream.test-utils'

/**
 * Pi's real Bedrock stream over HTTP/2 against a loopback server. The patched transport keeps one
 * client per configuration, and its requests share one HTTP/2 session.
 */

const MODEL = AMAZON_BEDROCK_MODELS['eu.anthropic.claude-haiku-4-5-20251001-v1:0']

function userContext(): Context {
  return { messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }
}

afterEach(() => {
  clearBedrockClients()
})

/** A loopback HTTP/2 server; `respond` decides whether a stream on the nth session gets an answer. */
async function withHttp2Server<T>(
  run: (baseUrl: string, sessions: () => number) => Promise<T>,
  respond: (session: number, streamOnSession: number) => boolean = () => true,
) {
  const server = createHttp2Server()
  let sessions = 0
  server.on('session', (session) => {
    sessions += 1
    Reflect.set(session, 'testSessionId', sessions)
    Reflect.set(session, 'testStreams', 0)
  })
  server.on('stream', (stream) => {
    const session = stream.session
    const streams = Number(Reflect.get(session ?? {}, 'testStreams')) + 1
    Reflect.set(session ?? {}, 'testStreams', streams)
    const sessionId = Number(Reflect.get(session ?? {}, 'testSessionId'))
    stream.on('data', () => undefined)
    stream.on('end', () => {
      // A connection whose path died: the request is sent and never answered.
      if (!respond(sessionId, streams)) return
      stream.respond({ ':status': 200, 'content-type': 'application/vnd.amazon.eventstream' })
      stream.end(TEXT_FRAMES)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address: AddressInfo | string | null = server.address()
    if (address === null || typeof address === 'string') throw new Error('No TCP address')
    return await run(`http://127.0.0.1:${String(address.port)}`, () => sessions)
  } finally {
    clearBedrockClients()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const HTTP2_ENV = { AWS_BEDROCK_SKIP_AUTH: '1', no_proxy: '127.0.0.1', NO_PROXY: '127.0.0.1' }

function sendHttp2(baseUrl: string, signal?: AbortSignal) {
  return streamBedrock({ ...MODEL, baseUrl }, normalizeContext(userContext()), {
    region: 'eu-west-1',
    maxRetries: 0,
    env: HTTP2_ENV,
    ...(signal ? { signal } : {}),
  }).result()
}

const HUNG = 'hung'
const HANG_BOUND_MS = 2_000

/** The request's result, or HUNG once it waited `HANG_BOUND_MS`; a hung request is aborted. */
function sendOrHung(baseUrl: string) {
  const abort = new AbortController()
  return Promise.race([
    sendHttp2(baseUrl, abort.signal),
    new Promise<typeof HUNG>((resolve) =>
      setTimeout(() => {
        abort.abort()
        resolve(HUNG)
      }, HANG_BOUND_MS),
    ),
  ])
}

describe('Amazon Bedrock HTTP/2 sessions', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens a new connection after the client sat idle, so a silently dead one cannot hang', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const result = await withHttp2Server(
      async (baseUrl, sessions) => {
        expect((await sendHttp2(baseUrl)).stopReason).toBe('stop')
        vi.setSystemTime(Date.now() + 31_000)

        const second = await sendOrHung(baseUrl)
        return { second, sessions: sessions() }
      },
      // Only a session's first request is answered, as if the path died once it went idle.
      (_session, streamOnSession) => streamOnSession === 1,
    )

    expect(result.second).not.toBe(HUNG)
    expect(result.second).toMatchObject({ stopReason: 'stop' })
    expect(result.sessions).toBe(2)
  })

  it('share one session between requests, where the SDK default opened one per request', async () => {
    const server = createHttp2Server()
    let sessions = 0
    server.on('session', () => {
      sessions += 1
    })
    server.on('stream', (stream) => {
      stream.on('data', () => undefined)
      stream.on('end', () => {
        stream.respond({ ':status': 200, 'content-type': 'application/vnd.amazon.eventstream' })
        stream.end(TEXT_FRAMES)
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address: AddressInfo | string | null = server.address()
      if (address === null || typeof address === 'string') throw new Error('No TCP address')
      const baseUrl = `http://127.0.0.1:${String(address.port)}`
      const env = { AWS_BEDROCK_SKIP_AUTH: '1', no_proxy: '127.0.0.1', NO_PROXY: '127.0.0.1' }
      for (let index = 0; index < 3; index++) {
        const result = await streamBedrock({ ...MODEL, baseUrl }, normalizeContext(userContext()), {
          region: 'eu-west-1',
          maxRetries: 0,
          env,
        }).result()
        expect(result.stopReason).toBe('stop')
      }
      expect(sessions).toBe(1)
    } finally {
      clearBedrockClients()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
