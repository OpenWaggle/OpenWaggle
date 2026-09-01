import { contentText, fauxAssistantMessage } from '@earendil-works/pi-ai'
import type { SessionCompactEvent } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupNativeSessions,
  createNativeSession,
  createNativeTempDirectory,
  nativeCompactionFetch,
} from './pi-native-compaction-integration.test-utils'

describe('Pi automatic compaction endpoint boundaries', () => {
  afterEach(cleanupNativeSessions)

  it('does not reclassify a successful compaction when post-success auth refresh fails', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-refresh-failure-')
    const events: SessionCompactEvent[] = []
    const compactionEndOutcomes: string[] = []
    let failAuthRefresh = false
    const thresholdResponse = fauxAssistantMessage('Reached threshold')
    thresholdResponse.usage.input = 80
    thresholdResponse.usage.totalTokens = 80
    thresholdResponse.timestamp = Date.now() + 60_000
    const compactFetch = nativeCompactionFetch()
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const response = await compactFetch(input, init)
      failAuthRefresh = true
      return response
    })
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      authBaseUrlResolver: () => {
        if (failAuthRefresh) throw new Error('Refresh credentials unavailable')
        return 'https://endpoint-a.example.test/v1'
      },
      responses: [thresholdResponse],
    })
    session.subscribe((event) => {
      if (event.type === 'compaction_end') {
        compactionEndOutcomes.push(event.errorMessage ?? 'success')
      }
    })

    await session.prompt('Build context before successful compaction')
    await expect(session.prompt('Trigger successful compaction')).rejects.toThrow(
      'Refresh credentials unavailable',
    )

    expect(compactionEndOutcomes).toEqual(['success'])
    expect(events).toHaveLength(1)
  })

  it('reprojects messages when credentials change endpoint before compaction fails', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-auth-change-')
    const events: SessionCompactEvent[] = []
    const authBaseUrlState = { value: 'https://endpoint-a.example.test/v1' }
    vi.stubGlobal('fetch', nativeCompactionFetch(undefined, 2))
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      contextWindow: 10_000,
      authBaseUrlState,
      responses: [fauxAssistantMessage('More context')],
    })

    await session.compact()
    await session.prompt('Add context after the first checkpoint')
    expect(JSON.stringify(session.messages)).toContain('cmp_1')

    authBaseUrlState.value = 'https://endpoint-b.example.test/v1'
    await expect(session.compact()).rejects.toThrow('Connection error.')

    expect(session.model?.baseUrl).toBe(authBaseUrlState.value)
    expect(JSON.stringify(session.messages)).toContain('Initial context')
    expect(JSON.stringify(session.messages)).not.toContain('cmp_1')
  })

  it('fits reconstruction after automatic compaction changes endpoint and is cancelled', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-auto-boundary-')
    const events: SessionCompactEvent[] = []
    let boundaryPhase = false
    let boundaryResolutions = 0
    const providerContexts: string[] = []
    const thresholdResponse = fauxAssistantMessage('Context ready for compaction')
    thresholdResponse.usage.input = 80
    thresholdResponse.usage.totalTokens = 80
    thresholdResponse.timestamp = Date.now() + 60_000
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      cancelAutomaticCompaction: true,
      authBaseUrlResolver: () => {
        if (!boundaryPhase) return 'https://endpoint-a.example.test/v1'
        boundaryResolutions += 1
        return boundaryResolutions === 1
          ? 'https://endpoint-a.example.test/v1'
          : 'https://endpoint-b.example.test/v1'
      },
      responses: [
        thresholdResponse,
        (context) => {
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Continued after cancelled compaction')
        },
      ],
    })

    await session.compact()
    session.setAutoCompactionEnabled(false)
    await session.prompt('Build a high-usage previous turn')
    session.setAutoCompactionEnabled(true)
    boundaryPhase = true
    await session.prompt('Mandatory request after endpoint change')

    expect(providerContexts[0]).toContain('Mandatory request after endpoint change')
    expect(providerContexts[0]).not.toContain('cmp_1')
    expect(session.model?.baseUrl).toBe('https://endpoint-b.example.test/v1')
  })

  it('refreshes the request endpoint after portable compaction fails', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-portable-failure-')
    const events: SessionCompactEvent[] = []
    let boundaryPhase = false
    let boundaryResolutions = 0
    let compactionRequests = 0
    const providerBaseUrls: string[] = []
    const providerContexts: string[] = []
    const thresholdResponse = fauxAssistantMessage('Context ready for portable fallback')
    thresholdResponse.usage.input = 960
    thresholdResponse.usage.totalTokens = 960
    thresholdResponse.timestamp = Date.now() + 60_000
    const portableFailure = fauxAssistantMessage('')
    portableFailure.stopReason = 'error'
    portableFailure.errorMessage = 'Portable summary failed'
    const compactFetch = nativeCompactionFetch()
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      compactionRequests += 1
      if (compactionRequests > 1) return new Response(null, { status: 404 })
      return compactFetch(input, init)
    })
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      contextWindow: 1_200,
      authBaseUrlResolver: () => {
        if (!boundaryPhase) return 'https://endpoint-a.example.test/v1'
        boundaryResolutions += 1
        return boundaryResolutions <= 2
          ? 'https://endpoint-c.example.test/v1'
          : 'https://endpoint-d.example.test/v1'
      },
      responses: [
        thresholdResponse,
        portableFailure,
        (context, _options, _state, model) => {
          providerBaseUrls.push(model.baseUrl)
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Continued after portable failure')
        },
      ],
    })

    await session.compact()
    session.setAutoCompactionEnabled(false)
    await session.prompt('Build a high-usage previous turn')
    session.setAutoCompactionEnabled(true)
    boundaryPhase = true
    await session.prompt('Mandatory request after portable failure')

    expect(providerBaseUrls).toEqual(['https://endpoint-d.example.test/v1'])
    expect(providerContexts[0]).toContain('Mandatory request after portable failure')
    expect(providerContexts[0]).not.toContain('cmp_1')
  })

  it('fits a 404 portable fallback using its own request framing', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-portable-budget-')
    const endpoint = 'https://endpoint-a.example.test/v1'
    const contextWindow = 800
    const portablePrompts: string[] = []
    const portableRequestTokens: number[] = []
    vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
    const { session, sessionManager } = await createNativeSession({
      directory,
      compactionEvents: [],
      authBaseUrl: endpoint,
      contextWindow,
      initialContext: `LONG-HISTORY ${'verbose context '.repeat(100)}`,
      systemPrompt: 'Native-only project instruction. '.repeat(120),
      responses: Array.from({ length: 2 }, () => (context, options) => {
        portablePrompts.push(JSON.stringify(context))
        const serializedRequest = [
          `system:${context.systemPrompt}`,
          ...context.messages.map(
            (message) => `${message.role}:${contentText(message.content, '')}`,
          ),
        ].join('\n\n')
        portableRequestTokens.push(
          Math.ceil(serializedRequest.length / 4) + (options?.maxTokens ?? 0),
        )
        return fauxAssistantMessage('Portable checkpoint')
      }),
    })
    for (let index = 0; index < 120; index += 1) {
      sessionManager.appendMessage({
        role: 'user',
        content: `SHORT-HISTORY-${index}`,
        timestamp: index * 2 + 2,
      })
      sessionManager.appendMessage(fauxAssistantMessage('x', { timestamp: index * 2 + 3 }))
    }
    sessionManager.appendCompaction('Native compaction checkpoint', 'native-replacement', 800, {
      schemaVersion: 1,
      mechanism: 'native',
      identity: {
        api: 'openai-responses',
        provider: 'native-provider',
        baseUrl: endpoint,
        compactionBaseUrl: endpoint,
        modelId: 'native-model',
      },
      items: [{ type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' }],
    })
    sessionManager.appendMessage({ role: 'user', content: 'Recent request', timestamp: 2 })
    sessionManager.appendMessage(fauxAssistantMessage('Recent response', { timestamp: 3 }))

    await session.compact()

    expect(portablePrompts.some((prompt) => prompt.includes('SHORT-HISTORY'))).toBe(true)
    expect(
      portablePrompts.every((prompt) => !prompt.includes('Native-only project instruction')),
    ).toBe(true)
    expect(portableRequestTokens.every((tokens) => tokens <= contextWindow)).toBe(true)
  })

  it('removes a reconstructed overflow response after the final endpoint refresh', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-overflow-refresh-')
    const events: SessionCompactEvent[] = []
    let overflowReturned = false
    let boundaryResolutions = 0
    const retryBaseUrls: string[] = []
    const retryContexts: string[] = []
    const overflowResponse = fauxAssistantMessage('')
    overflowResponse.stopReason = 'error'
    overflowResponse.errorMessage = 'maximum context length exceeded'
    overflowResponse.timestamp = Date.now() + 60_000
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      systemPrompt: 'Native compaction test prompt',
      authBaseUrlResolver: () => {
        if (!overflowReturned) return 'https://endpoint-a.example.test/v1'
        boundaryResolutions += 1
        return boundaryResolutions === 1
          ? 'https://endpoint-b.example.test/v1'
          : 'https://endpoint-c.example.test/v1'
      },
      responses: [
        () => {
          overflowReturned = true
          return overflowResponse
        },
        (context, _options, _state, model) => {
          retryBaseUrls.push(model.baseUrl)
          retryContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Recovered after overflow compaction')
        },
      ],
    })

    await session.compact()
    await session.prompt('Request that overflows endpoint A')

    expect(retryBaseUrls).toEqual(['https://endpoint-c.example.test/v1'])
    expect(retryContexts[0]).toContain('Request that overflows endpoint A')
    expect(retryContexts[0]).not.toContain('maximum context length exceeded')
    expect(session.model?.baseUrl).toBe('https://endpoint-c.example.test/v1')
  })
})
