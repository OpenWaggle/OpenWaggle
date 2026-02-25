import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockOpenExternal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockClipboardReadText = vi.hoisted(() => vi.fn().mockReturnValue(''))

vi.mock('electron', () => ({
  shell: { openExternal: mockOpenExternal },
  clipboard: { readText: mockClipboardReadText },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

vi.mock('../pkce', () => ({
  generateCodeVerifier: () => 'test-verifier',
  generateCodeChallenge: () => 'test-challenge',
}))

describe('Anthropic OAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('opens browser with correct Anthropic auth URL', async () => {
    // Simulate clipboard containing code#state after first poll
    let pollCount = 0
    mockClipboardReadText.mockImplementation(() => {
      pollCount++
      // First call captures initial content, second returns the code
      return pollCount <= 1 ? '' : 'test-code#test-verifier'
    })

    const tokenResponse = {
      access_token: 'sk-ant-oat01-test',
      refresh_token: 'rt',
      expires_in: 28800,
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(tokenResponse),
      }),
    )

    const { startAnthropicOAuth } = await import('./anthropic-oauth')
    const promise = startAnthropicOAuth()

    // Advance timers to trigger clipboard polling
    await vi.advanceTimersByTimeAsync(600)

    await promise

    expect(mockOpenExternal).toHaveBeenCalledWith(
      expect.stringContaining('claude.ai/oauth/authorize'),
    )
    expect(mockOpenExternal).toHaveBeenCalledWith(
      expect.stringContaining('code_challenge=test-challenge'),
    )
    // Verify Anthropic-specific params
    const authUrl = new URL(mockOpenExternal.mock.calls[0]?.[0])
    expect(authUrl.searchParams.get('code')).toBe('true')
    expect(authUrl.searchParams.get('state')).toBe('test-verifier')
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'https://console.anthropic.com/oauth/code/callback',
    )
    expect(authUrl.searchParams.get('scope')).toBe('org:create_api_key user:profile user:inference')
  })

  it('exchanges code for access/refresh tokens using JSON body', async () => {
    let pollCount = 0
    mockClipboardReadText.mockImplementation(() => {
      pollCount++
      return pollCount <= 1 ? '' : 'auth-code#test-verifier'
    })

    const tokenResponse = {
      access_token: 'sk-ant-oat01-access',
      refresh_token: 'anthropic-refresh',
      expires_in: 28800,
    }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(tokenResponse),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { startAnthropicOAuth } = await import('./anthropic-oauth')
    const promise = startAnthropicOAuth()

    await vi.advanceTimersByTimeAsync(600)
    const result = await promise

    expect(result.accessToken).toBe('sk-ant-oat01-access')
    expect(result.refreshToken).toBe('anthropic-refresh')
    // expiresAt includes 5-minute buffer subtraction
    expect(result.expiresAt).toBeGreaterThan(Date.now())

    // Verify JSON body (not form-encoded)
    const fetchCall = mockFetch.mock.calls[0]
    expect(fetchCall?.[0]).toContain('/v1/oauth/token')
    const fetchInit = fetchCall?.[1] as RequestInit
    expect(fetchInit.headers).toEqual({ 'Content-Type': 'application/json' })
    const body = JSON.parse(fetchInit.body as string)
    expect(body.grant_type).toBe('authorization_code')
    expect(body.code).toBe('auth-code')
    expect(body.state).toBe('test-verifier')
    expect(body.code_verifier).toBe('test-verifier')
  })

  it('throws sanitized error on failed token exchange', async () => {
    let pollCount = 0
    mockClipboardReadText.mockImplementation(() => {
      pollCount++
      return pollCount <= 1 ? '' : 'bad-code#test-verifier'
    })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('third_party_not_allowed'),
      }),
    )

    const { startAnthropicOAuth } = await import('./anthropic-oauth')
    let caughtError: Error | undefined
    const promise = startAnthropicOAuth().catch((err: Error) => {
      caughtError = err
    })

    await vi.advanceTimersByTimeAsync(600)
    await promise

    expect(caughtError?.message).toBe('Anthropic authentication failed. Please try again.')
  })

  it('times out after 5 minutes of clipboard polling', async () => {
    // Clipboard never changes
    mockClipboardReadText.mockReturnValue('unchanged')

    const { startAnthropicOAuth } = await import('./anthropic-oauth')
    // Attach rejection handler immediately to prevent unhandled rejection
    let caughtError: Error | undefined
    const promise = startAnthropicOAuth().catch((err: Error) => {
      caughtError = err
    })

    // Advance past the 5-minute timeout
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000)
    await promise

    expect(caughtError?.message).toBe('Timed out waiting for authorization code. Please try again.')
  })

  it('stops clipboard polling when manual code is submitted first', async () => {
    mockClipboardReadText.mockReturnValue('unchanged')
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          access_token: 'sk-ant-oat01-manual',
          refresh_token: 'manual-rt',
          expires_in: 28800,
        }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { startAnthropicOAuth } = await import('./anthropic-oauth')
    const promise = startAnthropicOAuth(Promise.resolve('manual-code#test-verifier'))

    await vi.advanceTimersByTimeAsync(10_000)
    await promise

    expect(mockClipboardReadText).toHaveBeenCalledTimes(1)
    const fetchBody = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit).body as string)
    expect(fetchBody.code).toBe('manual-code')
    expect(fetchBody.state).toBe('test-verifier')
  })

  describe('refreshAnthropicToken', () => {
    it('refreshes token successfully with JSON body', async () => {
      const refreshResponse = {
        access_token: 'sk-ant-oat01-refreshed',
        refresh_token: 'new-rt',
        expires_in: 28800,
      }
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(refreshResponse),
      })
      vi.stubGlobal('fetch', mockFetch)

      const { refreshAnthropicToken } = await import('./anthropic-oauth')
      const result = await refreshAnthropicToken('old-refresh-token')

      expect(result.accessToken).toBe('sk-ant-oat01-refreshed')
      expect(result.refreshToken).toBe('new-rt')
      expect(result.expiresAt).toBeGreaterThan(Date.now())

      // Verify JSON body
      const fetchInit = mockFetch.mock.calls[0]?.[1] as RequestInit
      expect(fetchInit.headers).toEqual({ 'Content-Type': 'application/json' })
      const body = JSON.parse(fetchInit.body as string)
      expect(body.grant_type).toBe('refresh_token')
    })

    it('throws sanitized error on failed refresh', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: () => Promise.resolve('invalid_token'),
        }),
      )

      const { refreshAnthropicToken } = await import('./anthropic-oauth')
      await expect(refreshAnthropicToken('bad-token')).rejects.toThrow(
        'Anthropic token refresh failed. Please sign in again.',
      )
    })
  })
})
