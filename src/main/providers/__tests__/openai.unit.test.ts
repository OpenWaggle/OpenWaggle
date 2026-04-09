import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createOpenaiChat: vi.fn(),
}))

vi.mock('@tanstack/ai-openai', () => ({
  OPENAI_CHAT_MODELS: ['gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-5', 'gpt-5.1-codex'] as const,
  createOpenaiChat: mocks.createOpenaiChat,
}))

const INVALID_OPENAI_MODELS = ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max'] as const

function createAccessTokenWithAccountId(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: accountId },
    }),
  ).toString('base64url')
  return `header.${payload}.signature`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasFetchConfig(value: unknown): value is { fetch: typeof fetch } {
  return isRecord(value) && 'fetch' in value && typeof value.fetch === 'function'
}

describe('openaiProvider model ids', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.createOpenaiChat.mockReset()
  })

  it('does not expose invalid model IDs', async () => {
    const { openaiProvider } = await import('../openai')
    const modelSet = new Set(openaiProvider.models)
    for (const model of INVALID_OPENAI_MODELS) {
      expect(modelSet.has(model)).toBe(false)
    }
  })

  it('accepts dynamically fetched model IDs without throwing', async () => {
    const { openaiProvider } = await import('../openai')
    for (const model of INVALID_OPENAI_MODELS) {
      expect(() => openaiProvider.createAdapter(model, 'sk-test')).not.toThrow()
    }
    expect(mocks.createOpenaiChat).toHaveBeenCalledTimes(INVALID_OPENAI_MODELS.length)
  })

  it('uses OpenAI API defaults for API-key auth mode', async () => {
    const { openaiProvider } = await import('../openai')

    openaiProvider.createAdapter('gpt-4.1-mini', 'token-api-key', undefined, 'api-key')

    expect(mocks.createOpenaiChat).toHaveBeenCalledWith('gpt-4.1-mini', 'token-api-key')
  })

  it('routes subscription auth through Codex responses endpoint and forces store=false', async () => {
    const { openaiProvider } = await import('../openai')
    const token = createAccessTokenWithAccountId('acct_test_123')

    openaiProvider.createAdapter('gpt-5.1-codex', token, undefined, 'subscription')

    const firstCall = mocks.createOpenaiChat.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, , adapterConfig] = firstCall ?? []
    if (!hasFetchConfig(adapterConfig)) {
      throw new Error('Expected OpenAI subscription adapter config to include custom fetch')
    }
    const subscriptionConfig = adapterConfig

    expect(mocks.createOpenaiChat).toHaveBeenCalledWith(
      'gpt-5.1-codex',
      token,
      expect.objectContaining({
        baseURL: 'https://chatgpt.com/backend-api',
        fetch: expect.any(Function),
      }),
    )

    let rewrittenUrl: RequestInfo | URL | undefined
    let rewrittenInit: RequestInit | undefined
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      await subscriptionConfig.fetch('https://chatgpt.com/backend-api/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-4.1-mini',
          max_output_tokens: 1024,
          max_tokens: 2048,
          max_completion_tokens: 4096,
          metadata: { key: 'value' },
          user: 'test-user',
          context_management: { strategy: 'auto' },
        }),
      })
      ;[rewrittenUrl, rewrittenInit] = fetchSpy.mock.calls[0] ?? []
    } finally {
      fetchSpy.mockRestore()
    }

    expect(rewrittenUrl).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(rewrittenInit).toBeDefined()
    if (
      !rewrittenInit ||
      typeof rewrittenInit.body !== 'string' ||
      rewrittenInit.headers === undefined
    ) {
      throw new Error('Expected rewritten request body for OpenAI Codex subscription fetch')
    }
    const rewrittenHeaders = new Headers(rewrittenInit.headers)
    const rewrittenPayloadRaw: unknown = JSON.parse(rewrittenInit.body)
    if (!isRecord(rewrittenPayloadRaw)) {
      throw new Error('Expected rewritten request payload to be an object')
    }
    const rewrittenPayload = rewrittenPayloadRaw

    expect(rewrittenPayload.store).toBe(false)
    expect(rewrittenPayload.stream).toBe(true)
    // All token-limit and other Codex-unsupported params must be stripped
    expect(rewrittenPayload.max_output_tokens).toBeUndefined()
    expect(rewrittenPayload.max_tokens).toBeUndefined()
    expect(rewrittenPayload.max_completion_tokens).toBeUndefined()
    expect(rewrittenPayload.metadata).toBeUndefined()
    expect(rewrittenPayload.user).toBeUndefined()
    expect(rewrittenPayload.context_management).toBeUndefined()
    expect(rewrittenPayload.tool_choice).toBe('auto')
    expect(rewrittenPayload.parallel_tool_calls).toBe(true)
    expect(rewrittenPayload.text).toMatchObject({ verbosity: 'medium' })
    expect(rewrittenPayload.include).toEqual(
      expect.arrayContaining(['reasoning.encrypted_content']),
    )
    expect(rewrittenHeaders.get('OpenAI-Beta')).toBe('responses=experimental')
    expect(rewrittenHeaders.get('originator')).toBe('openwaggle')
    expect(rewrittenHeaders.get('chatgpt-account-id')).toBe('acct_test_123')
    expect(rewrittenHeaders.get('User-Agent')).toContain('openwaggle (')
  })

  it('strips max_output_tokens for reasoning models in Codex subscription', async () => {
    const { openaiProvider } = await import('../openai')
    const token = createAccessTokenWithAccountId('acct_reasoning_test')

    openaiProvider.createAdapter('gpt-5.4', token, undefined, 'subscription')

    const firstCall = mocks.createOpenaiChat.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, , adapterConfig] = firstCall ?? []
    if (!hasFetchConfig(adapterConfig)) {
      throw new Error('Expected OpenAI subscription adapter config to include custom fetch')
    }

    let rewrittenInit: RequestInit | undefined
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      await adapterConfig.fetch('https://chatgpt.com/backend-api/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-5.4',
          max_output_tokens: 16800,
          reasoning: { effort: 'medium', summary: 'auto' },
        }),
      })
      ;[, rewrittenInit] = fetchSpy.mock.calls[0] ?? []
    } finally {
      fetchSpy.mockRestore()
    }

    expect(rewrittenInit).toBeDefined()
    if (!rewrittenInit || typeof rewrittenInit.body !== 'string') {
      throw new Error('Expected rewritten request body')
    }
    const payload: unknown = JSON.parse(rewrittenInit.body)
    if (!isRecord(payload)) {
      throw new Error('Expected rewritten payload to be an object')
    }

    // Codex endpoint rejects max_output_tokens for ALL models — it controls
    // output budget server-side. Must be stripped even for reasoning models.
    expect(payload.max_output_tokens).toBeUndefined()
    // Reasoning options must still survive the transport
    expect(payload.reasoning).toEqual({ effort: 'medium', summary: 'auto' })
    expect(payload.store).toBe(false)
    expect(payload.stream).toBe(true)
  })

  it('normalizes backend-api base URL requests to codex responses', async () => {
    const { openaiProvider } = await import('../openai')
    const token = createAccessTokenWithAccountId('acct_test_456')

    openaiProvider.createAdapter('gpt-5.1-codex', token, undefined, 'subscription')

    const firstCall = mocks.createOpenaiChat.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, , adapterConfig] = firstCall ?? []
    if (!hasFetchConfig(adapterConfig)) {
      throw new Error('Expected OpenAI subscription adapter config to include custom fetch')
    }

    let rewrittenUrl: RequestInfo | URL | undefined
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      await adapterConfig.fetch('https://chatgpt.com/backend-api', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-5.1-codex' }),
      })
      ;[rewrittenUrl] = fetchSpy.mock.calls[0] ?? []
    } finally {
      fetchSpy.mockRestore()
    }

    expect(rewrittenUrl).toBe('https://chatgpt.com/backend-api/codex/responses')
  })

  it('allows non-codex model names for subscription auth mode', async () => {
    const { openaiProvider } = await import('../openai')
    const token = createAccessTokenWithAccountId('acct_test_789')

    openaiProvider.createAdapter('gpt-4.1-mini', token, undefined, 'subscription')

    expect(mocks.createOpenaiChat).toHaveBeenCalledWith(
      'gpt-4.1-mini',
      token,
      expect.objectContaining({
        baseURL: 'https://chatgpt.com/backend-api',
        fetch: expect.any(Function),
      }),
    )
  })

  it('preserves upstream include entries while ensuring reasoning.encrypted_content', async () => {
    const { openaiProvider } = await import('../openai')
    const token = createAccessTokenWithAccountId('acct_include_test')

    openaiProvider.createAdapter('gpt-5.1-codex', token, undefined, 'subscription')

    const firstCall = mocks.createOpenaiChat.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, , adapterConfig] = firstCall ?? []
    if (!hasFetchConfig(adapterConfig)) {
      throw new Error('Expected OpenAI subscription adapter config to include custom fetch')
    }

    let rewrittenInit: RequestInit | undefined
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      await adapterConfig.fetch('https://chatgpt.com/backend-api/responses', {
        method: 'POST',
        body: JSON.stringify({
          model: 'gpt-5.1-codex',
          include: ['output.usage', 'reasoning.encrypted_content'],
        }),
      })
      ;[, rewrittenInit] = fetchSpy.mock.calls[0] ?? []
    } finally {
      fetchSpy.mockRestore()
    }

    expect(rewrittenInit).toBeDefined()
    if (!rewrittenInit || typeof rewrittenInit.body !== 'string') {
      throw new Error('Expected rewritten request body')
    }
    const payload: unknown = JSON.parse(rewrittenInit.body)
    if (!isRecord(payload)) {
      throw new Error('Expected rewritten payload to be an object')
    }

    // Must keep the upstream 'output.usage' entry
    expect(payload.include).toEqual(
      expect.arrayContaining(['output.usage', 'reasoning.encrypted_content']),
    )
    // Must not duplicate 'reasoning.encrypted_content'
    const includeArray = payload.include
    if (!Array.isArray(includeArray)) {
      throw new Error('Expected include to be an array')
    }
    const reasoningEntries = includeArray.filter(
      (entry: unknown) => entry === 'reasoning.encrypted_content',
    )
    expect(reasoningEntries).toHaveLength(1)
  })

  it('adds reasoning.encrypted_content when no upstream include exists', async () => {
    const { openaiProvider } = await import('../openai')
    const token = createAccessTokenWithAccountId('acct_no_include_test')

    openaiProvider.createAdapter('gpt-5.1-codex', token, undefined, 'subscription')

    const firstCall = mocks.createOpenaiChat.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [, , adapterConfig] = firstCall ?? []
    if (!hasFetchConfig(adapterConfig)) {
      throw new Error('Expected OpenAI subscription adapter config to include custom fetch')
    }

    let rewrittenInit: RequestInit | undefined
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    try {
      await adapterConfig.fetch('https://chatgpt.com/backend-api/responses', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-5.1-codex' }),
      })
      ;[, rewrittenInit] = fetchSpy.mock.calls[0] ?? []
    } finally {
      fetchSpy.mockRestore()
    }

    expect(rewrittenInit).toBeDefined()
    if (!rewrittenInit || typeof rewrittenInit.body !== 'string') {
      throw new Error('Expected rewritten request body')
    }
    const payload: unknown = JSON.parse(rewrittenInit.body)
    if (!isRecord(payload)) {
      throw new Error('Expected rewritten payload to be an object')
    }

    expect(payload.include).toEqual(['reasoning.encrypted_content'])
  })

  it('rejects subscription tokens without chatgpt account id', async () => {
    const { openaiProvider } = await import('../openai')

    expect(() =>
      openaiProvider.createAdapter('gpt-5.1-codex', 'not-a-jwt-token', undefined, 'subscription'),
    ).toThrow('chatgpt_account_id')
  })
})
