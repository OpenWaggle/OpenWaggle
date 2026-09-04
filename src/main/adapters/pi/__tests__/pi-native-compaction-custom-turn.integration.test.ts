import { fauxAssistantMessage } from '@earendil-works/pi-ai'
import type { SessionCompactEvent } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkpointIds,
  cleanupNativeSessions,
  createNativeSession,
  createNativeTempDirectory,
  nativeCompactionFetch,
} from './pi-native-compaction-integration.test-utils'

function codexAccessToken(accountId: string, nonce: string) {
  const payload = Buffer.from(
    JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId }, nonce }),
  ).toString('base64url')
  return `header.${payload}.signature`
}

describe('Pi native compaction custom turns', () => {
  afterEach(cleanupNativeSessions)

  it('applies provider lifecycle hooks to Native compaction requests', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-provider-hooks-')
    const events: SessionCompactEvent[] = []
    const providerLifecycleCounter = { headerCalls: 0, payloadCalls: 0, responseCalls: 0 }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('x-openwaggle-compaction-hook')).toBe('enabled')
      expect(JSON.parse(String(init?.body))).toMatchObject({ openwaggle_compaction_hook: true })
      return nativeCompactionFetch()(_input, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      providerLifecycleCounter,
    })

    await session.compact()

    expect(providerLifecycleCounter).toEqual({ headerCalls: 1, payloadCalls: 1, responseCalls: 1 })
  })

  it('prepares endpoint compatibility and compaction before trigger-turn messages', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-custom-turn-')
    const events: SessionCompactEvent[] = []
    const authBaseUrlState = { value: 'https://endpoint-a.example.test/v1' }
    const providerBaseUrls: string[] = []
    const providerContexts: string[] = []
    const thresholdResponse = fauxAssistantMessage('Threshold reached')
    thresholdResponse.usage.input = 80
    thresholdResponse.usage.totalTokens = 80
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      authBaseUrlState,
      responses: [
        thresholdResponse,
        (context, _options, _state, model) => {
          providerBaseUrls.push(model.baseUrl)
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Custom turn continued')
        },
      ],
    })

    await session.prompt('Build enough context')
    authBaseUrlState.value = 'https://endpoint-b.example.test/v1'
    await session.sendCustomMessage(
      {
        customType: 'openwaggle.waggle',
        content: 'Mandatory Waggle continuation',
        display: true,
      },
      { triggerTurn: true },
    )

    expect(checkpointIds(events)).toEqual(['cmp_1'])
    expect(providerBaseUrls).toEqual([authBaseUrlState.value])
    expect(providerContexts[0]).toContain('cmp_1')
    expect(providerContexts[0]).toContain('Mandatory Waggle continuation')
  })

  it('uses one prepared auth snapshot for context projection and transport', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-auth-snapshot-')
    const events: SessionCompactEvent[] = []
    let phase: 'compact' | 'prompt' = 'compact'
    let promptAuthResolutions = 0
    const providerBaseUrls: string[] = []
    const providerContexts: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      contextWindow: 10_000,
      authBaseUrlResolver: () => {
        if (phase === 'compact') return 'https://endpoint-a.example.test/v1'
        promptAuthResolutions += 1
        return promptAuthResolutions === 1
          ? 'https://endpoint-b.example.test/v1'
          : 'https://endpoint-c.example.test/v1'
      },
      responses: [
        (context, _options, _state, model) => {
          providerBaseUrls.push(model.baseUrl)
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Response from prepared endpoint')
        },
      ],
    })

    await session.compact()
    phase = 'prompt'
    await session.prompt('Continue with one auth snapshot')

    expect(promptAuthResolutions).toBe(1)
    expect(providerBaseUrls).toEqual(['https://endpoint-b.example.test/v1'])
    expect(providerContexts[0]).toContain('Initial context')
    expect(providerContexts[0]).not.toContain('cmp_1')
  })

  it('reconstructs raw history when the credential changes without changing endpoints', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-credential-change-')
    const events: SessionCompactEvent[] = []
    const apiKeyState = { value: 'credential-a' }
    const providerContexts: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      apiKeyState,
      contextWindow: 10_000,
      responses: [
        (context) => {
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Response with replacement credential')
        },
      ],
    })

    await session.compact()
    apiKeyState.value = 'credential-b'
    await session.prompt('Continue after replacing credentials')

    expect(providerContexts[0]).toContain('Initial context')
    expect(providerContexts[0]).not.toContain('cmp_1')
  })

  it('survives an OAuth refresh but reconstructs when the ChatGPT account changes', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-account-change-')
    const events: SessionCompactEvent[] = []
    const apiKeyState = { value: codexAccessToken('account-a', 'token-1') }
    const providerContexts: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      apiKeyState,
      contextWindow: 10_000,
      responses: [
        (context) => {
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Response after token refresh')
        },
        (context) => {
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Response after account change')
        },
      ],
    })

    await session.compact()
    apiKeyState.value = codexAccessToken('account-a', 'token-2')
    await session.prompt('Continue after refreshing the access token')
    apiKeyState.value = codexAccessToken('account-b', 'token-3')
    await session.prompt('Continue after switching ChatGPT accounts')

    expect(providerContexts[0]).toContain('cmp_1')
    expect(providerContexts[1]).toContain('Initial context')
    expect(providerContexts[1]).not.toContain('cmp_1')
  })

  it('preserves every queued request message while fitting reconstructed history', async () => {
    const directory = createNativeTempDirectory('openwaggle-native-events-multi-request-')
    const events: SessionCompactEvent[] = []
    const authBaseUrlState = { value: 'https://endpoint-a.example.test/v1' }
    const providerContexts: string[] = []
    vi.stubGlobal('fetch', nativeCompactionFetch())
    const { session } = await createNativeSession({
      directory,
      compactionEvents: events,
      authBaseUrlState,
      responses: [
        (context) => {
          providerContexts.push(JSON.stringify(context.messages))
          return fauxAssistantMessage('Processed the complete pending request')
        },
      ],
    })

    await session.compact()
    authBaseUrlState.value = 'https://endpoint-b.example.test/v1'
    await session.sendCustomMessage(
      { customType: 'test.first', content: 'First mandatory queued instruction', display: false },
      { triggerTurn: false, deliverAs: 'nextTurn' },
    )
    await session.sendCustomMessage(
      { customType: 'test.second', content: 'Second mandatory queued instruction', display: false },
      { triggerTurn: false, deliverAs: 'nextTurn' },
    )
    await session.prompt('Mandatory user request')

    expect(providerContexts[0]).toContain('Mandatory user request')
    expect(providerContexts[0]).toContain('First mandatory queued instruction')
    expect(providerContexts[0]).toContain('Second mandatory queued instruction')
  })
})
