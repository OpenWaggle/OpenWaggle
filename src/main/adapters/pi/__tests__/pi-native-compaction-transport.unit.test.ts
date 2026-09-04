import type { Context, Model } from '@earendil-works/pi-ai'
import { compactResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { compact } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeCompactResponse,
  makeNativeModel,
  makePreparation,
  NATIVE_DETAILS,
} from './pi-native-compaction-test-fixtures'

describe('Pi Responses native compaction transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the public compact endpoint and returns its canonical replacement items', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: 'native-model',
        instructions: 'System instructions',
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Keep this context' }],
          },
        ],
      })
      return makeCompactResponse([
        { role: 'user', content: [{ type: 'input_text', text: 'Keep this context' }] },
        { type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' },
      ])
    })
    const model = makeNativeModel({
      compat: {
        supportsCompaction: true,
        compactionBaseUrl: 'https://compaction.example.test/v1',
      },
    })
    const context: Context = {
      systemPrompt: 'System instructions',
      messages: [{ role: 'user', content: 'Keep this context', timestamp: 1 }],
    }

    const result = await compactResponses(model, context, {
      apiKey: 'test-key',
      fetch: fetchMock,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://compaction.example.test/v1/responses/compact',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.output.at(-1)).toEqual({
      type: 'compaction',
      id: 'cmp_1',
      encrypted_content: 'opaque-checkpoint',
    })
  })

  it('uses Codex OAuth account headers for subscription compaction', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        'https://api.openai.com/auth': { chatgpt_account_id: 'account-123' },
      }),
    ).toString('base64url')
    const accessToken = `header.${payload}.signature`
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe(`Bearer ${accessToken}`)
      expect(headers.get('chatgpt-account-id')).toBe('account-123')
      expect(headers.get('originator')).toBe('pi')
      return makeCompactResponse([
        { type: 'compaction', id: 'cmp_codex', encrypted_content: 'opaque-checkpoint' },
      ])
    })
    const model: Model<'openai-codex-responses'> = {
      ...makeNativeModel(),
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    }

    await compactResponses(
      model,
      { systemPrompt: '', messages: [] },
      {
        apiKey: accessToken,
        fetch: fetchMock,
      },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/responses/compact',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('decodes base64url Codex OAuth payloads before extracting the account header', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        name: '😀',
        'https://api.openai.com/auth': { chatgpt_account_id: 'account-url-safe' },
      }),
    ).toString('base64url')
    expect(payload).toContain('-')
    const accessToken = `header.${payload}.signature`
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('chatgpt-account-id')).toBe('account-url-safe')
      return makeCompactResponse([
        { type: 'compaction', id: 'cmp_codex', encrypted_content: 'opaque-checkpoint' },
      ])
    })
    const model: Model<'openai-codex-responses'> = {
      ...makeNativeModel(),
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    }

    await compactResponses(
      model,
      { systemPrompt: '', messages: [] },
      { apiKey: accessToken, fetch: fetchMock },
    )
  })

  it('preserves extension-provided Codex gateway headers', async () => {
    const payload = Buffer.from(
      JSON.stringify({
        'https://api.openai.com/auth': { chatgpt_account_id: 'default-account' },
      }),
    ).toString('base64url')
    const accessToken = `header.${payload}.signature`
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer extension-token')
      expect(headers.get('chatgpt-account-id')).toBe('extension-account')
      expect(headers.get('originator')).toBe('extension-originator')
      expect(headers.get('openai-beta')).toBe('extension-beta')
      expect(headers.get('user-agent')).toBe('extension-agent')
      return makeCompactResponse([
        { type: 'compaction', id: 'cmp_headers', encrypted_content: 'opaque-checkpoint' },
      ])
    })
    const model: Model<'openai-codex-responses'> = {
      ...makeNativeModel(),
      api: 'openai-codex-responses',
      provider: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
    }

    await compactResponses(
      model,
      { systemPrompt: '', messages: [] },
      {
        apiKey: accessToken,
        headers: {
          Authorization: 'Bearer extension-token',
          'chatgpt-account-id': 'extension-account',
          originator: 'extension-originator',
          'OpenAI-Beta': 'extension-beta',
          'User-Agent': 'extension-agent',
        },
        fetch: fetchMock,
      },
    )
  })

  it('accepts header-only authentication for a Codex-compatible gateway', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer gateway-token')
      return makeCompactResponse([
        { type: 'compaction', id: 'cmp_gateway', encrypted_content: 'opaque-checkpoint' },
      ])
    })
    const model: Model<'openai-codex-responses'> = {
      ...makeNativeModel(),
      api: 'openai-codex-responses',
      provider: 'custom-codex-gateway',
      baseUrl: 'https://gateway.example.test/codex',
    }

    await compactResponses(
      model,
      { systemPrompt: '', messages: [] },
      {
        headers: { Authorization: 'Bearer gateway-token' },
        fetch: fetchMock,
      },
    )
  })

  it('persists a versioned opaque envelope without invoking Portable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        makeCompactResponse([
          { type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' },
        ]),
      ),
    )
    const portableStream = vi.fn(() => {
      throw new Error('Portable must not run')
    })

    const result = await compact(
      makePreparation(),
      makeNativeModel({
        cost: { input: 2, output: 3, cacheRead: 0.5, cacheWrite: 0 },
      }),
      'test-key',
      undefined,
      undefined,
      undefined,
      undefined,
      portableStream,
      undefined,
      undefined,
      undefined,
      'session-1',
      'System instructions',
    )

    expect(portableStream).not.toHaveBeenCalled()
    expect(result.firstKeptEntryId).toBe('native-replacement')
    expect(result.details).toEqual({
      ...NATIVE_DETAILS,
      identity: {
        ...NATIVE_DETAILS.identity,
        credentialFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    })
    expect(JSON.stringify(result.details)).not.toContain('test-key')
    expect(result.usage).toBeDefined()
    if (!result.usage) throw new Error('Expected Native compaction usage')
    expect(result.usage.cost.input).toBeCloseTo(0.0002)
    expect(result.usage.cost.output).toBeCloseTo(0.00003)
    expect(result.usage.cost.cacheRead).toBe(0)
    expect(result.usage.cost.cacheWrite).toBe(0)
    expect(result.usage.cost.total).toBeCloseTo(0.00023)
  })

  it('includes manual compaction instructions in the Native request', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        instructions: expect.stringContaining('Preserve schema decisions'),
      })
      return makeCompactResponse([
        { type: 'compaction', id: 'cmp_1', encrypted_content: 'opaque-checkpoint' },
      ])
    })
    vi.stubGlobal('fetch', fetchMock)

    await compact(
      makePreparation(),
      makeNativeModel(),
      'test-key',
      undefined,
      'Preserve schema decisions',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'session-1',
      'System instructions',
    )

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('applies Pi retry timing and callbacks to transient Native failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'transient rate limit' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
        }),
      )
      .mockResolvedValueOnce(
        makeCompactResponse([
          { type: 'compaction', id: 'cmp_retry', encrypted_content: 'opaque-checkpoint' },
        ]),
      )
    vi.stubGlobal('fetch', fetchMock)
    const callbacks = {
      onRetryScheduled: vi.fn(),
      onRetryAttemptStart: vi.fn(),
      onRetryFinished: vi.fn(),
    }

    await compact(
      makePreparation(),
      makeNativeModel(),
      'test-key',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enabled: true, maxRetries: 2, baseDelayMs: 7 },
      callbacks,
      'session-1',
      'System instructions',
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(callbacks.onRetryScheduled).toHaveBeenCalledWith(
      1,
      2,
      7,
      expect.stringContaining('transient rate limit'),
    )
    expect(callbacks.onRetryAttemptStart).toHaveBeenCalledOnce()
    expect(callbacks.onRetryFinished).toHaveBeenCalledWith(true, 1)
  })

  it('does not retry terminal quota failures from Native compaction', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'insufficient_quota', message: 'quota exceeded for this account' },
          }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
          },
        ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const callbacks = {
      onRetryScheduled: vi.fn(),
      onRetryAttemptStart: vi.fn(),
      onRetryFinished: vi.fn(),
    }

    await expect(
      compact(
        makePreparation(),
        makeNativeModel(),
        'test-key',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { enabled: true, maxRetries: 2, baseDelayMs: 7 },
        callbacks,
        'session-1',
        'System instructions',
      ),
    ).rejects.toThrow('quota exceeded')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(callbacks.onRetryScheduled).not.toHaveBeenCalled()
    expect(callbacks.onRetryAttemptStart).not.toHaveBeenCalled()
    expect(callbacks.onRetryFinished).not.toHaveBeenCalled()
  })
})
