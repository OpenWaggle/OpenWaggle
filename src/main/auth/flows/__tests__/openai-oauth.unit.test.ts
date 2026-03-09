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
const mockCreateCallbackServer = vi.hoisted(() => vi.fn())

vi.mock('../../oauth-callback-server', () => ({
  createCallbackServer: mockCreateCallbackServer,
}))

vi.mock('../../pkce', () => ({
  generateCodeVerifier: () => 'test-verifier',
  generateCodeChallenge: () => 'test-challenge',
}))

describe('OpenAI OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateCallbackServer.mockResolvedValue({
      port: 1455,
      waitForCallback: mockWaitForCallback,
      close: mockClose,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens browser with correct OpenAI auth URL', async () => {
    mockWaitForCallback.mockImplementation(async () => {
      const authUrl = mockOpenExternal.mock.calls[0]?.[0]
      const url = new URL(authUrl)
      return { code: 'test-code', state: url.searchParams.get('state') }
    })
    const tokenResponse = {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      }),
    )

    const { startOpenAIOAuth } = await import('../openai-oauth')
    await startOpenAIOAuth()

    expect(mockOpenExternal).toHaveBeenCalledWith(
      expect.stringContaining('auth.openai.com/oauth/authorize'),
    )
    expect(mockOpenExternal).toHaveBeenCalledWith(
      expect.stringContaining('code_challenge=test-challenge'),
    )

    // Verify OpenAI-specific additional params
    const authUrl = new URL(mockOpenExternal.mock.calls[0]?.[0])
    expect(authUrl.searchParams.get('id_token_add_organizations')).toBe('true')
    expect(authUrl.searchParams.get('codex_cli_simplified_flow')).toBe('true')
    expect(authUrl.searchParams.get('originator')).toBe('openwaggle')
  })

  it('exchanges code for access/refresh tokens', async () => {
    // We can't easily match the random state, so just capture any callback
    mockWaitForCallback.mockImplementation(async () => {
      // Extract the state from the auth URL that was opened
      const authUrl = mockOpenExternal.mock.calls[0]?.[0]
      const url = new URL(authUrl)
      return { code: 'auth-code', state: url.searchParams.get('state') }
    })

    const tokenResponse = {
      access_token: 'openai-access-token',
      refresh_token: 'openai-refresh-token',
      expires_in: 7200,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      }),
    )

    const { startOpenAIOAuth } = await import('../openai-oauth')
    const result = await startOpenAIOAuth()

    expect(result.accessToken).toBe('openai-access-token')
    expect(result.refreshToken).toBe('openai-refresh-token')
    expect(result.expiresAt).toBeGreaterThan(Date.now())
  })

  it('throws on state mismatch (CSRF protection)', async () => {
    mockWaitForCallback.mockResolvedValue({ code: 'code', state: 'wrong-state' })

    const { startOpenAIOAuth } = await import('../openai-oauth')
    await expect(startOpenAIOAuth()).rejects.toThrow('state mismatch')
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
        status: 400,
        text: () => Promise.resolve('invalid_grant'),
      }),
    )

    const { startOpenAIOAuth } = await import('../openai-oauth')
    await expect(startOpenAIOAuth()).rejects.toThrow(
      'OpenAI authentication failed. Please try again.',
    )
  })

  it('always closes the callback server', async () => {
    mockWaitForCallback.mockRejectedValue(new Error('timeout'))

    const { startOpenAIOAuth } = await import('../openai-oauth')
    await expect(startOpenAIOAuth()).rejects.toThrow('timeout')

    expect(mockClose).toHaveBeenCalled()
  })

  it('falls back to manual code entry when callback server is unavailable', async () => {
    mockCreateCallbackServer.mockRejectedValue(new Error('EADDRINUSE'))
    const tokenResponse = {
      access_token: 'openai-access-token',
      refresh_token: 'openai-refresh-token',
      expires_in: 7200,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      }),
    )
    const onAwaitingCode = vi.fn()
    const onCodeReceived = vi.fn()

    const { startOpenAIOAuth } = await import('../openai-oauth')
    const result = await startOpenAIOAuth({
      manualCodePromise: Promise.resolve('auth-code'),
      onAwaitingCode,
      onCodeReceived,
    })

    expect(result.accessToken).toBe('openai-access-token')
    expect(onAwaitingCode).toHaveBeenCalledTimes(1)
    expect(onCodeReceived).toHaveBeenCalledTimes(1)
  })

  it('fails fast when callback server is unavailable and no manual input is provided', async () => {
    mockCreateCallbackServer.mockRejectedValue(new Error('EADDRINUSE'))

    const { startOpenAIOAuth } = await import('../openai-oauth')
    await expect(startOpenAIOAuth()).rejects.toThrow(
      'Unable to receive OpenAI authorization code. Please try again.',
    )
  })

  describe('refreshOpenAIToken', () => {
    it('refreshes token successfully', async () => {
      const refreshResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(refreshResponse),
        }),
      )

      const { refreshOpenAIToken } = await import('../openai-oauth')
      const result = await refreshOpenAIToken('old-refresh-token')

      expect(result.accessToken).toBe('new-access-token')
      expect(result.expiresAt).toBeGreaterThan(Date.now())
    })

    it('throws sanitized error on failed refresh', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: () => Promise.resolve('invalid_refresh_token'),
        }),
      )

      const { refreshOpenAIToken } = await import('../openai-oauth')
      await expect(refreshOpenAIToken('bad-token')).rejects.toThrow(
        'OpenAI token refresh failed. Please sign in again.',
      )
    })
  })
})
