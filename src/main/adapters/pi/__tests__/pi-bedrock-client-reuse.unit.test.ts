import { createServer, type IncomingHttpHeaders } from 'node:http'
import { createServer as createHttp2Server } from 'node:http2'
import type { AddressInfo } from 'node:net'
import type { Context } from '@earendil-works/pi-ai'
import { stream as streamBedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import {
  clearBedrockClients,
  getBedrockClientCacheSize,
} from '@earendil-works/pi-ai/bedrock-provider'
import { AMAZON_BEDROCK_MODELS } from '@earendil-works/pi-ai/providers/amazon-bedrock.models'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { afterEach, describe, expect, it } from 'vitest'
import { withExpiredCredentialRetry } from '../pi-bedrock-credential-retry'
import { bedrockEventFrame } from './bedrock-event-stream.test-utils'

/**
 * Pi's real Bedrock stream against a loopback server. Pi used to build a new BedrockRuntimeClient
 * for every model call: a new credential provider (an SSO call each time) and a new connection.
 * The patched transport keeps one client per configuration.
 */

const MODEL = AMAZON_BEDROCK_MODELS['eu.anthropic.claude-haiku-4-5-20251001-v1:0']

const TEXT_FRAMES = Buffer.concat([
  bedrockEventFrame('messageStart', { role: 'assistant' }),
  bedrockEventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: 'Hello' } }),
  bedrockEventFrame('contentBlockStop', { contentBlockIndex: 0 }),
  bedrockEventFrame('messageStop', { stopReason: 'end_turn' }),
  bedrockEventFrame('metadata', {
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    metrics: { latencyMs: 1 },
  }),
])

interface RecordedRequest {
  readonly headers: IncomingHttpHeaders
  readonly body: string
  readonly connection: number
}

interface ServerOptions {
  /** The first `rejectExpired` requests fail like AWS rejects expired STS credentials. */
  readonly rejectExpired?: number
}

async function withServer<T>(
  run: (baseUrl: string, requests: RecordedRequest[]) => Promise<T>,
  options: ServerOptions = {},
) {
  const requests: RecordedRequest[] = []
  let connections = 0
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const connection = Number(Reflect.get(request.socket, 'testConnectionId'))
      requests.push({
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
        connection,
      })
      if (requests.length <= (options.rejectExpired ?? 0)) {
        response.writeHead(403, {
          'content-type': 'application/json',
          'x-amzn-errortype': 'ExpiredTokenException',
        })
        response.end(
          JSON.stringify({ message: 'The security token included in the request is expired' }),
        )
        return
      }
      response.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream' })
      response.end(TEXT_FRAMES)
    })
  })
  server.on('connection', (socket) => {
    connections += 1
    Reflect.set(socket, 'testConnectionId', connections)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address: AddressInfo | string | null = server.address()
    if (address === null || typeof address === 'string') throw new Error('No TCP address')
    return await run(`http://127.0.0.1:${String(address.port)}`, requests)
  } finally {
    clearBedrockClients()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

const ENV = {
  AWS_BEDROCK_SKIP_AUTH: '1',
  AWS_BEDROCK_FORCE_HTTP1: '1',
  no_proxy: '127.0.0.1',
  NO_PROXY: '127.0.0.1',
}

function userContext(text = 'hello'): Context {
  return { messages: [{ role: 'user', content: text, timestamp: 0 }] }
}

function send(
  baseUrl: string,
  options: { readonly headers?: Record<string, string>; readonly context?: Context } = {},
) {
  return streamBedrock({ ...MODEL, baseUrl }, normalizeContext(options.context ?? userContext()), {
    region: 'eu-west-1',
    maxRetries: 0,
    env: ENV,
    ...(options.headers ? { headers: options.headers } : {}),
  }).result()
}

afterEach(() => {
  clearBedrockClients()
})

describe('Amazon Bedrock client reuse', () => {
  it('sends every request of one configuration through one client and one connection', async () => {
    const connections = await withServer(async (baseUrl, requests) => {
      for (let index = 0; index < 3; index++) {
        const result = await send(baseUrl)
        expect(result.stopReason).toBe('stop')
      }
      expect(getBedrockClientCacheSize()).toBe(1)
      return requests.map((request) => request.connection)
    })

    expect(connections).toEqual([1, 1, 1])
  })

  it('keeps per-request headers on their own request', async () => {
    const headers = await withServer(async (baseUrl, requests) => {
      await send(baseUrl, { headers: { 'x-test-request': 'first' } })
      await send(baseUrl, { headers: { 'x-test-request': 'second' } })
      await send(baseUrl)
      return requests.map((request) => request.headers['x-test-request'])
    })

    expect(headers).toEqual(['first', 'second', undefined])
  })

  it('builds a new client, and a new connection, after the clients are cleared', async () => {
    const connections = await withServer(async (baseUrl, requests) => {
      await send(baseUrl)
      clearBedrockClients()
      expect(getBedrockClientCacheSize()).toBe(0)
      await send(baseUrl)
      return requests.map((request) => request.connection)
    })

    expect(connections).toEqual([1, 2])
  })

  it('keeps a client separate for another region', async () => {
    await withServer(async (baseUrl) => {
      await send(baseUrl)
      await streamBedrock({ ...MODEL, baseUrl }, normalizeContext(userContext()), {
        region: 'us-east-1',
        maxRetries: 0,
        env: ENV,
      }).result()
      expect(getBedrockClientCacheSize()).toBe(2)
    })
  })

  it('retries expired credentials on a fresh client', async () => {
    const { result, connections } = await withServer(
      async (baseUrl, requests) => {
        const retrying = withExpiredCredentialRetry(streamBedrock, {
          delayMs: 0,
          invalidateClients: clearBedrockClients,
        })
        const result = await retrying({ ...MODEL, baseUrl }, normalizeContext(userContext()), {
          region: 'eu-west-1',
          maxRetries: 0,
          env: ENV,
        }).result()
        return { result, connections: requests.map((request) => request.connection) }
      },
      { rejectExpired: 1 },
    )

    expect(result.stopReason).toBe('stop')
    expect(connections).toEqual([1, 2])
  })
})

interface ConverseBody {
  readonly system?: readonly Record<string, unknown>[]
  readonly toolConfig?: { readonly tools: readonly Record<string, unknown>[] }
}

function parseBody(body: string): ConverseBody {
  const parsed: unknown = JSON.parse(body)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Not a JSON object')
  return parsed
}

const READ_TOOL = {
  name: 'read',
  description: 'Read a file',
  parameters: { type: 'object', properties: { path: { type: 'string' } } },
}

function sectionedContext(): Context {
  return {
    messages: [
      {
        role: 'system',
        content: '',
        sections: {
          preamble: 'You are a coding assistant.',
          skills: '<skills>\nproject skills\n</skills>',
          cwd: '<cwd>\n/work/session-a\n</cwd>',
          openwaggle_session_identity: '<identity>\nsession a\n</identity>',
        },
        toolsAdded: [READ_TOOL],
        timestamp: 0,
      },
      { role: 'user', content: 'hello', timestamp: 1 },
    ],
  }
}

describe('Amazon Bedrock cache points', () => {
  it('caches the tools and the shared system prefix apart from the per-session sections', async () => {
    const body = await withServer(async (baseUrl, requests) => {
      await streamBedrock({ ...MODEL, baseUrl }, normalizeContext(sectionedContext()), {
        region: 'eu-west-1',
        maxRetries: 0,
        env: ENV,
        systemCacheBoundary: 'cwd',
      }).result()
      return parseBody(requests[0]?.body ?? '{}')
    })

    expect(body.system).toEqual([
      { text: 'You are a coding assistant.\n\n<skills>\nproject skills\n</skills>' },
      { cachePoint: { type: 'default' } },
      { text: '<cwd>\n/work/session-a\n</cwd>\n\n<identity>\nsession a\n</identity>' },
      { cachePoint: { type: 'default' } },
    ])
    expect(body.toolConfig?.tools.at(-1)).toEqual({ cachePoint: { type: 'default' } })
    expect(body.toolConfig?.tools).toHaveLength(2)
  })

  it('keeps one system cache point when there is no boundary', async () => {
    const body = await withServer(async (baseUrl, requests) => {
      await streamBedrock({ ...MODEL, baseUrl }, normalizeContext(sectionedContext()), {
        region: 'eu-west-1',
        maxRetries: 0,
        env: ENV,
      }).result()
      return parseBody(requests[0]?.body ?? '{}')
    })

    expect(body.system).toHaveLength(2)
    expect(body.system?.[1]).toEqual({ cachePoint: { type: 'default' } })
  })

  it('writes no tools cache point for a non-Claude model that forces caching', async () => {
    const nova = AMAZON_BEDROCK_MODELS['amazon.nova-pro-v1:0']
    const body = await withServer(async (baseUrl, requests) => {
      await streamBedrock({ ...nova, baseUrl }, normalizeContext(sectionedContext()), {
        region: 'eu-west-1',
        maxRetries: 0,
        env: { ...ENV, AWS_BEDROCK_FORCE_CACHE: '1' },
      }).result()
      return parseBody(requests[0]?.body ?? '{}')
    })

    // Bedrock documents tool checkpoints for Claude only; system ones still apply.
    expect(body.toolConfig?.tools).toHaveLength(1)
    expect(JSON.stringify(body.toolConfig)).not.toContain('cachePoint')
    expect(body.system?.at(-1)).toEqual({ cachePoint: { type: 'default' } })
  })

  it('writes no cache points when prompt caching is off', async () => {
    const body = await withServer(async (baseUrl, requests) => {
      await streamBedrock({ ...MODEL, baseUrl }, normalizeContext(sectionedContext()), {
        region: 'eu-west-1',
        maxRetries: 0,
        env: ENV,
        cacheRetention: 'none',
        systemCacheBoundary: 'cwd',
      }).result()
      return parseBody(requests[0]?.body ?? '{}')
    })

    expect(body.system).toHaveLength(1)
    expect(body.toolConfig?.tools).toHaveLength(1)
  })
})

describe('Amazon Bedrock HTTP/2 sessions', () => {
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
