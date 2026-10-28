import type { Context } from '@earendil-works/pi-ai'
import { stream as streamBedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import {
  clearBedrockClients,
  getBedrockClientCacheSize,
} from '@earendil-works/pi-ai/bedrock-provider'
import { AMAZON_BEDROCK_MODELS } from '@earendil-works/pi-ai/providers/amazon-bedrock.models'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withExpiredCredentialRetry } from '../pi-bedrock-credential-retry'
import {
  BEDROCK_LOOPBACK_ENV as ENV,
  userContext,
  withBedrockServer as withServer,
} from './bedrock-loopback-server.test-utils'

/**
 * Pi's real Bedrock stream against a loopback server. Pi used to build a new BedrockRuntimeClient
 * for every model call: a new credential provider (an SSO call each time) and a new connection.
 * The patched transport keeps one client per configuration.
 */

const MODEL = AMAZON_BEDROCK_MODELS['eu.anthropic.claude-haiku-4-5-20251001-v1:0']

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

  it('keeps the client but opens a new HTTP/1.1 connection after sitting idle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const connections = await withServer(async (baseUrl, requests) => {
        await send(baseUrl)
        await send(baseUrl)
        vi.setSystemTime(Date.now() + 31_000)
        expect((await send(baseUrl)).stopReason).toBe('stop')
        expect(getBedrockClientCacheSize()).toBe(1)
        return requests.map((request) => request.connection)
      })

      expect(connections).toEqual([1, 1, 2])
    } finally {
      vi.useRealTimers()
    }
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

  it('drops the client whose credentials AWS refused, so fixed credentials apply at once', async () => {
    const { first, second, connections } = await withServer(
      async (baseUrl, requests) => {
        const retrying = withExpiredCredentialRetry(streamBedrock, {
          delayMs: 0,
          invalidateClients: clearBedrockClients,
        })
        const call = () =>
          retrying({ ...MODEL, baseUrl }, normalizeContext(userContext()), {
            region: 'eu-west-1',
            maxRetries: 0,
            env: ENV,
          }).result()
        const first = await call()
        // Refused credentials are not retried: the same ones would be refused again.
        expect(requests).toHaveLength(1)
        expect(getBedrockClientCacheSize()).toBe(0)
        const second = await call()
        return { first, second, connections: requests.map((request) => request.connection) }
      },
      { rejectInvalid: 1 },
    )

    expect(first.errorMessage).toContain('UnrecognizedClientException')
    expect(second.stopReason).toBe('stop')
    // The second request built a new client, with a new connection and credential chain.
    expect(connections).toEqual([1, 2])
  })
})
