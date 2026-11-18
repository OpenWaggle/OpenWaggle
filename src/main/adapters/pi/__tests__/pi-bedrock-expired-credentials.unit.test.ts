import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { stream as streamBedrock } from '@earendil-works/pi-ai/api/bedrock-converse-stream'
import { AMAZON_BEDROCK_MODELS } from '@earendil-works/pi-ai/providers/amazon-bedrock.models'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { classifyErrorMessage } from '@shared/types/errors'
import { describe, expect, it } from 'vitest'
import { withExpiredCredentialRetry } from '../pi-bedrock-credential-retry'
import { bedrockEventFrame } from './bedrock-event-stream.test-utils'

/**
 * Pi's real Bedrock stream against a loopback server that rejects requests the way AWS rejects
 * expired STS credentials: HTTP 403 with `ExpiredTokenException`.
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

async function withServer<T>(rejections: number, run: (baseUrl: string) => Promise<T>) {
  let requests = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      requests += 1
      if (requests <= rejections) {
        response.writeHead(403, {
          'content-type': 'application/json',
          'x-amzn-errortype': 'ExpiredTokenException',
          'x-amzn-requestid': `request-${String(requests)}`,
        })
        response.end(
          JSON.stringify({ message: 'The security token included in the request is expired' }),
        )
        return
      }
      response.writeHead(200, {
        'content-type': 'application/vnd.amazon.eventstream',
        'x-amzn-requestid': `request-${String(requests)}`,
      })
      response.end(TEXT_FRAMES)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address: AddressInfo | string | null = server.address()
    if (address === null || typeof address === 'string') throw new Error('No TCP address')
    const result = await run(`http://127.0.0.1:${String(address.port)}`)
    return { result, requests }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function send(baseUrl: string) {
  const stream = withExpiredCredentialRetry(streamBedrock, { delayMs: 0 })
  return stream(
    { ...MODEL, baseUrl },
    normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }),
    {
      region: 'eu-west-1',
      maxRetries: 0,
      env: {
        AWS_BEDROCK_SKIP_AUTH: '1',
        AWS_BEDROCK_FORCE_HTTP1: '1',
        no_proxy: '127.0.0.1',
        NO_PROXY: '127.0.0.1',
      },
    },
  ).result()
}

describe('Amazon Bedrock request with expired credentials', () => {
  it('is made once more, and answers when the credentials resolve again', async () => {
    const { result, requests } = await withServer(1, send)

    expect(requests).toBe(2)
    expect(result.stopReason).toBe('stop')
    expect(result.content).toEqual([{ type: 'text', text: 'Hello' }])
  })

  it('fails as expired provider credentials when they are still expired', async () => {
    const { result, requests } = await withServer(2, send)

    expect(requests).toBe(2)
    expect(result.stopReason).toBe('error')
    expect(classifyErrorMessage(result.errorMessage ?? '')).toMatchObject({
      code: 'session-expired',
      userMessage: 'Provider credentials expired',
    })
  })
})
