import { type AssistantMessage, createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { compactResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { compact } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeAssistant,
  makeCompactResponse,
  makeNativeModel,
  makePreparation,
} from './pi-native-compaction-test-fixtures'

/** A Sign in with ChatGPT access token: sent straight to OpenAI, it is not an `sk-` API key. */
const CHATGPT_ACCESS_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.chatgpt-subscription.signature'
const OPENAI_API_KEY = 'sk-test-key'

const openAIModel = makeNativeModel({
  provider: 'openai',
  id: 'gpt-5.6-sol',
  baseUrl: 'https://api.openai.com/v1',
})

function capturedPayloads() {
  const payloads: unknown[] = []
  return {
    payloads,
    onPayload: (payload: unknown) => {
      payloads.push(payload)
      return undefined
    },
  }
}

const PORTABLE_RESPONSE: AssistantMessage = makeAssistant('Portable handoff for a ChatGPT login', 2)

function createPortableStream() {
  return vi.fn(() => {
    const stream = createAssistantMessageEventStream()
    stream.end(PORTABLE_RESPONSE)
    return stream
  })
}

function compactWith(apiKey: string, portableStream: ReturnType<typeof createPortableStream>) {
  return compact(
    makePreparation(),
    openAIModel,
    apiKey,
    undefined,
    undefined,
    undefined,
    undefined,
    portableStream,
    undefined,
    { enabled: false, maxRetries: 0, baseDelayMs: 0 },
    undefined,
    'session-1',
    'System instructions',
  )
}

describe('Native compaction under Sign in with ChatGPT', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('omits the fields ChatGPT logins reject, and only for a ChatGPT login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => makeCompactResponse([{ type: 'compaction', encrypted_content: 'x' }])),
    )
    const chatGpt = capturedPayloads()
    const headerOnly = capturedPayloads()
    const context = { systemPrompt: 'System', messages: [] }

    await compactResponses(openAIModel, context, {
      apiKey: CHATGPT_ACCESS_TOKEN,
      cacheRetention: 'long',
      onPayload: chatGpt.onPayload,
    })
    // Header-only API-key auth: Pi's client key placeholder must not be read as a ChatGPT login.
    await compactResponses(openAIModel, context, {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      cacheRetention: 'long',
      onPayload: headerOnly.onPayload,
    })

    expect(chatGpt.payloads[0]).toMatchObject({ prompt_cache_retention: undefined })
    expect(headerOnly.payloads[0]).toMatchObject({ prompt_cache_retention: '24h' })
  })

  it.each([400, 401, 403])(
    'uses Portable when a ChatGPT login cannot use the Native endpoint (%i)',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => makeCompactResponse([], status)),
      )
      const portableStream = createPortableStream()

      const result = await compactWith(CHATGPT_ACCESS_TOKEN, portableStream)

      expect(portableStream).toHaveBeenCalledOnce()
      expect(result.details).toMatchObject({ mechanism: 'portable' })
    },
  )

  it.each([400, 401, 403])(
    'keeps Native status %i visible for an OpenAI API key',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => makeCompactResponse([], status)),
      )
      const portableStream = createPortableStream()

      await expect(compactWith(OPENAI_API_KEY, portableStream)).rejects.toThrow()
      expect(portableStream).not.toHaveBeenCalled()
    },
  )
})
