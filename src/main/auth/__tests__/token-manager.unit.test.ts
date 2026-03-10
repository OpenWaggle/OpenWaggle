import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  userDataDir: '',
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => state.userDataDir,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

async function disposeRuntime(): Promise<void> {
  const { disposeAppRuntime } = await import('../../runtime')
  await disposeAppRuntime()
}

async function loadTokenManagerModule() {
  const module = await import('../token-manager')
  await module.initializeTokenStore()
  return module
}

async function readStoredToken(key: string): Promise<string | undefined> {
  const { runAppEffect } = await import('../../runtime')
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ encrypted_value: string }>`
        SELECT encrypted_value
        FROM auth_tokens
        WHERE provider = ${key}
        LIMIT 1
      `
      return rows[0]?.encrypted_value
    }),
  )
}

describe('token-manager', () => {
  beforeEach(async () => {
    await disposeRuntime()
    vi.resetModules()
    state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-token-test-'))
  })

  afterEach(async () => {
    await disposeRuntime()
    if (state.userDataDir) {
      await fs.rm(state.userDataDir, { recursive: true, force: true })
    }
  })

  describe('storeTokens / getTokens', () => {
    it('stores encrypted tokens for OpenRouter', async () => {
      const { storeTokens } = await loadTokenManagerModule()
      storeTokens('openrouter', { apiKey: 'sk-or-v1-test' })

      await import('../token-manager').then((module) => module.flushTokenStoreForTests())
      const stored = await readStoredToken('openrouter')
      expect(stored).toContain('enc:v1:')
    })

    it('stores encrypted tokens for OAuth providers', async () => {
      const { storeTokens } = await loadTokenManagerModule()
      storeTokens('openai', {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: 1000,
      })

      await import('../token-manager').then((module) => module.flushTokenStoreForTests())
      const stored = await readStoredToken('openai')
      expect(stored).toContain('enc:v1:')
    })

    it('retrieves and decrypts OpenRouter tokens', async () => {
      const tokens = { apiKey: 'sk-or-v1-test' }
      const { storeTokens, getTokens } = await loadTokenManagerModule()

      storeTokens('openrouter', tokens)

      expect(getTokens('openrouter')).toEqual(tokens)
    })

    it('retrieves and decrypts OAuth tokens', async () => {
      const tokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: 1000 }
      const { storeTokens, getTokens } = await loadTokenManagerModule()

      storeTokens('openai', tokens)

      expect(getTokens('openai')).toEqual(tokens)
    })

    it('returns null when no tokens stored', async () => {
      const { getTokens } = await loadTokenManagerModule()
      expect(getTokens('openai')).toBeNull()
    })
  })

  describe('getTokens presence checks', () => {
    it('returns a token payload when stored tokens are valid', async () => {
      const { getTokens, storeTokens } = await loadTokenManagerModule()
      storeTokens('openrouter', { apiKey: 'sk-or-v1-test' })
      expect(getTokens('openrouter')).toEqual({ apiKey: 'sk-or-v1-test' })
    })

    it('returns null when no tokens exist', async () => {
      const { getTokens } = await loadTokenManagerModule()
      expect(getTokens('openrouter')).toBeNull()
    })
  })

  describe('clearTokens', () => {
    it('deletes tokens for a provider', async () => {
      const { clearTokens, storeTokens } = await loadTokenManagerModule()
      storeTokens('openai', {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: 1000,
      })

      clearTokens('openai')

      expect(await readStoredToken('openai')).toBeUndefined()
    })
  })

  describe('previousApiKey', () => {
    it('stores and retrieves previous API key', async () => {
      const { getPreviousApiKey, storePreviousApiKey } = await loadTokenManagerModule()

      storePreviousApiKey('openrouter', 'sk-old-key')

      await import('../token-manager').then((module) => module.flushTokenStoreForTests())
      const stored = await readStoredToken('prev-key:openrouter')
      expect(stored).toContain('enc:v1:')
      expect(getPreviousApiKey('openrouter')).toBe('sk-old-key')
    })

    it('returns empty string when no previous key', async () => {
      const { getPreviousApiKey } = await loadTokenManagerModule()
      expect(getPreviousApiKey('openai')).toBe('')
    })

    it('does not store empty API key', async () => {
      const { storePreviousApiKey } = await loadTokenManagerModule()
      storePreviousApiKey('openai', '')
      expect(await readStoredToken('prev-key:openai')).toBeUndefined()
    })

    it('clears previous API key', async () => {
      const { clearPreviousApiKey, storePreviousApiKey } = await loadTokenManagerModule()
      storePreviousApiKey('openai', 'sk-old-key')
      clearPreviousApiKey('openai')
      expect(await readStoredToken('prev-key:openai')).toBeUndefined()
    })
  })

  describe('getActiveAccessToken', () => {
    it('returns API key for OpenRouter', async () => {
      const { getActiveAccessToken, storeTokens } = await loadTokenManagerModule()
      storeTokens('openrouter', { apiKey: 'sk-or-v1-test' })
      await expect(getActiveAccessToken('openrouter')).resolves.toBe('sk-or-v1-test')
    })

    it('returns null when no tokens exist', async () => {
      const { getActiveAccessToken } = await loadTokenManagerModule()
      await expect(getActiveAccessToken('openai')).resolves.toBeNull()
    })

    it('returns access token when not expired', async () => {
      const { getActiveAccessToken, storeTokens } = await loadTokenManagerModule()
      storeTokens('openai', {
        accessToken: 'fresh-token',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60 * 60 * 1000,
      })

      await expect(getActiveAccessToken('openai')).resolves.toBe('fresh-token')
    })

    it('clears tokens after a fatal refresh failure', async () => {
      const { getActiveAccessToken, registerRefreshFn, storeTokens } =
        await loadTokenManagerModule()
      const { OAuthRefreshError } = await import('../flows/anthropic-oauth')

      registerRefreshFn('anthropic', async () => {
        throw new OAuthRefreshError(
          400,
          '{"error":"invalid_grant","error_description":"Refresh token not found or invalid"}',
        )
      })

      storeTokens('anthropic', {
        accessToken: 'stale-token',
        refreshToken: 'dead-refresh-token',
        expiresAt: Date.now() + 60_000,
      })

      await expect(getActiveAccessToken('anthropic')).resolves.toBeNull()
      expect(await readStoredToken('anthropic')).toBeUndefined()
    })
  })

  describe('hasStoredUsableAccessToken', () => {
    it('does not force a refresh for unexpired OAuth tokens', async () => {
      const { hasStoredUsableAccessToken, storeTokens } = await loadTokenManagerModule()
      storeTokens('anthropic', {
        accessToken: 'fresh-token',
        refreshToken: 'rt',
        expiresAt: Date.now() + 60 * 60 * 1000,
      })

      expect(hasStoredUsableAccessToken('anthropic')).toBe(true)
    })

    it('returns false for expired OAuth tokens', async () => {
      const { hasStoredUsableAccessToken, storeTokens } = await loadTokenManagerModule()
      storeTokens('anthropic', {
        accessToken: 'expired-token',
        refreshToken: 'rt',
        expiresAt: Date.now() - 1_000,
      })

      expect(hasStoredUsableAccessToken('anthropic')).toBe(false)
    })
  })
})
