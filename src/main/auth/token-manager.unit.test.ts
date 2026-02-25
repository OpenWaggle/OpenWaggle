import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStore = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('electron-store', () => {
  return {
    default: class MockStore {
      get = mockStore.get
      set = mockStore.set
      delete = mockStore.delete
    },
  }
})

vi.mock('../store/encryption', () => ({
  encryptString: (v: string) => `encrypted:${v}`,
  decryptString: (v: string) => (v.startsWith('encrypted:') ? v.slice('encrypted:'.length) : v),
  isEncryptionAvailable: () => true,
}))

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

describe('token-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('storeTokens / getTokens', () => {
    it('stores encrypted tokens for OpenRouter', async () => {
      const { storeTokens } = await import('./token-manager')
      storeTokens('openrouter', { apiKey: 'sk-or-v1-test' })
      expect(mockStore.set).toHaveBeenCalledWith(
        'openrouter',
        expect.stringContaining('encrypted:'),
      )
    })

    it('stores encrypted tokens for OAuth providers', async () => {
      const { storeTokens } = await import('./token-manager')
      storeTokens('openai', {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: 1000,
      })
      expect(mockStore.set).toHaveBeenCalledWith('openai', expect.stringContaining('encrypted:'))
    })

    it('retrieves and decrypts OpenRouter tokens', async () => {
      const tokens = { apiKey: 'sk-or-v1-test' }
      mockStore.get.mockReturnValue(`encrypted:${JSON.stringify(tokens)}`)

      const { getTokens } = await import('./token-manager')
      const result = getTokens('openrouter')
      expect(result).toEqual(tokens)
    })

    it('retrieves and decrypts OAuth tokens', async () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: 1000 }
      mockStore.get.mockReturnValue(`encrypted:${JSON.stringify(tokens)}`)

      const { getTokens } = await import('./token-manager')
      const result = getTokens('openai')
      expect(result).toEqual(tokens)
    })

    it('returns null when no tokens stored', async () => {
      mockStore.get.mockReturnValue(undefined)

      const { getTokens } = await import('./token-manager')
      expect(getTokens('openai')).toBeNull()
    })

    it('returns null for invalid stored JSON', async () => {
      mockStore.get.mockReturnValue('encrypted:not-json')

      const { getTokens } = await import('./token-manager')
      expect(getTokens('openai')).toBeNull()
    })
  })

  describe('hasTokens', () => {
    it('returns true when stored tokens are valid', async () => {
      mockStore.get.mockReturnValue('encrypted:{"apiKey":"sk-or-v1-test"}')

      const { hasTokens } = await import('./token-manager')
      expect(hasTokens('openrouter')).toBe(true)
    })

    it('returns false when stored tokens are invalid', async () => {
      mockStore.get.mockReturnValue('encrypted:not-json')

      const { hasTokens } = await import('./token-manager')
      expect(hasTokens('openrouter')).toBe(false)
    })

    it('returns false when no tokens exist', async () => {
      mockStore.get.mockReturnValue(undefined)

      const { hasTokens } = await import('./token-manager')
      expect(hasTokens('openrouter')).toBe(false)
    })
  })

  describe('clearTokens', () => {
    it('deletes tokens for a provider', async () => {
      const { clearTokens } = await import('./token-manager')
      clearTokens('openai')
      expect(mockStore.delete).toHaveBeenCalledWith('openai')
    })
  })

  describe('previousApiKey', () => {
    it('stores and retrieves previous API key', async () => {
      const { storePreviousApiKey, getPreviousApiKey } = await import('./token-manager')

      storePreviousApiKey('openrouter', 'sk-old-key')
      expect(mockStore.set).toHaveBeenCalledWith(
        'prev-key:openrouter',
        expect.stringContaining('encrypted:'),
      )

      mockStore.get.mockReturnValue('encrypted:sk-old-key')
      expect(getPreviousApiKey('openrouter')).toBe('sk-old-key')
    })

    it('returns empty string when no previous key', async () => {
      mockStore.get.mockReturnValue(undefined)

      const { getPreviousApiKey } = await import('./token-manager')
      expect(getPreviousApiKey('openai')).toBe('')
    })

    it('does not store empty API key', async () => {
      const { storePreviousApiKey } = await import('./token-manager')
      storePreviousApiKey('openai', '')
      expect(mockStore.set).not.toHaveBeenCalled()
    })

    it('clears previous API key', async () => {
      const { clearPreviousApiKey } = await import('./token-manager')
      clearPreviousApiKey('openai')
      expect(mockStore.delete).toHaveBeenCalledWith('prev-key:openai')
    })
  })

  describe('getActiveAccessToken', () => {
    it('returns API key for OpenRouter', async () => {
      const tokens = { apiKey: 'sk-or-v1-test' }
      mockStore.get.mockReturnValue(`encrypted:${JSON.stringify(tokens)}`)

      const { getActiveAccessToken } = await import('./token-manager')
      const result = await getActiveAccessToken('openrouter')
      expect(result).toBe('sk-or-v1-test')
    })

    it('returns null when no tokens exist', async () => {
      mockStore.get.mockReturnValue(undefined)

      const { getActiveAccessToken } = await import('./token-manager')
      const result = await getActiveAccessToken('openai')
      expect(result).toBeNull()
    })

    it('returns access token when not expired', async () => {
      const tokens = {
        accessToken: 'fresh-token',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
      }
      mockStore.get.mockReturnValue(`encrypted:${JSON.stringify(tokens)}`)

      const { getActiveAccessToken } = await import('./token-manager')
      const result = await getActiveAccessToken('openai')
      expect(result).toBe('fresh-token')
    })
  })
})
