import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockOpenExternal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('electron', () => ({
  shell: { openExternal: mockOpenExternal },
}))

vi.mock('../../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

const mockWaitForCallback = vi.hoisted(() => vi.fn())
const mockClose = vi.hoisted(() => vi.fn())

vi.mock('../../oauth-callback-server', () => ({
  createCallbackServer: () =>
    Promise.resolve({
      port: 12345,
      waitForCallback: mockWaitForCallback,
      close: mockClose,
    }),
}))

vi.mock('../../pkce', () => ({
  generateCodeVerifier: () => 'test-verifier',
  generateCodeChallenge: () => 'test-challenge',
}))

describe('OpenRouter OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens browser with correct auth URL including state', async () => {
    mockWaitForCallback.mockImplementation(async () => {
      const authUrl = mockOpenExternal.mock.calls[0]?.[0]
      const url = new URL(authUrl)
      return { code: 'test-code', state: url.searchParams.get('state') }
    })
    const mockFetchResponse = {
      ok: true,
      json: () => Promise.resolve({ key: 'sk-or-v1-result' }),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse))

    const { startOpenRouterOAuth } = await import('../openrouter-oauth')
    await startOpenRouterOAuth()

    expect(mockOpenExternal).toHaveBeenCalledWith(expect.stringContaining('openrouter.ai/auth'))
    expect(mockOpenExternal).toHaveBeenCalledWith(
      expect.stringContaining('code_challenge=test-challenge'),
    )
    expect(mockOpenExternal).toHaveBeenCalledWith(expect.stringContaining('state='))
  })

  it('exchanges code for API key', async () => {
    mockWaitForCallback.mockImplementation(async () => {
      const authUrl = mockOpenExternal.mock.calls[0]?.[0]
      const url = new URL(authUrl)
      return { code: 'auth-code-123', state: url.searchParams.get('state') }
    })
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ key: 'sk-or-v1-permanent-key' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { startOpenRouterOAuth } = await import('../openrouter-oauth')
    const result = await startOpenRouterOAuth()

    expect(result.apiKey).toBe('sk-or-v1-permanent-key')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/auth/keys',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws on state mismatch (CSRF protection)', async () => {
    mockWaitForCallback.mockResolvedValue({ code: 'code', state: 'wrong-state' })

    const { startOpenRouterOAuth } = await import('../openrouter-oauth')
    await expect(startOpenRouterOAuth()).rejects.toThrow('state mismatch')
  })

  it('throws sanitized error on failed token exchange', async () => {
    mockWaitForCallback.mockImplementation(async () => {
      const authUrl = mockOpenExternal.mock.calls[0]?.[0]
      const url = new URL(authUrl)
      return { code: 'bad-code', state: url.searchParams.get('state') }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      }),
    )

    const { startOpenRouterOAuth } = await import('../openrouter-oauth')
    await expect(startOpenRouterOAuth()).rejects.toThrow(
      'OpenRouter authentication failed. Please try again.',
    )
  })

  it('throws on unexpected response shape', async () => {
    mockWaitForCallback.mockImplementation(async () => {
      const authUrl = mockOpenExternal.mock.calls[0]?.[0]
      const url = new URL(authUrl)
      return { code: 'code', state: url.searchParams.get('state') }
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ unexpected: 'shape' }),
      }),
    )

    const { startOpenRouterOAuth } = await import('../openrouter-oauth')
    await expect(startOpenRouterOAuth()).rejects.toThrow('Unexpected response')
  })

  it('always closes the callback server', async () => {
    mockWaitForCallback.mockRejectedValue(new Error('timeout'))

    const { startOpenRouterOAuth } = await import('../openrouter-oauth')
    await expect(startOpenRouterOAuth()).rejects.toThrow('timeout')

    expect(mockClose).toHaveBeenCalled()
  })
})
