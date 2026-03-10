import * as SqlClient from '@effect/sql/SqlClient'
import { FIVE_MINUTES_IN_MILLISECONDS } from '@shared/constants/constants'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import type { SubscriptionProvider } from '@shared/types/auth'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { runAppEffect } from '../runtime'
import { decryptString, encryptString, isEncryptionAvailable } from '../store/encryption'
import { OAuthRefreshError as AnthropicOAuthRefreshError } from './flows/anthropic-oauth'
import { OAuthRefreshError as OpenAIOAuthRefreshError } from './flows/openai-oauth'

const logger = createLogger('token-manager')

const PREVIOUS_KEY_PREFIX = 'prev-key:'

interface AuthTokenRow {
  readonly provider: string
  readonly encrypted_value: string
}

// ─── Token Schemas ──────────────────────────────────────────────────

interface OpenRouterTokens {
  readonly apiKey: string
}

interface OAuthTokens {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

const openRouterTokenSchema = Schema.Struct({
  apiKey: Schema.String,
})

const oauthTokenSchema = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAt: Schema.Number,
})

// Providers that use OAuth token refresh (not OpenRouter — permanent key)
type OAuthProvider = 'openai' | 'anthropic'

type FatalOAuthRefreshError = AnthropicOAuthRefreshError | OpenAIOAuthRefreshError

const tokenCache = new Map<string, string>()
let initializationPromise: Promise<void> | null = null
let writeQueue: Promise<void> = Promise.resolve()

// ─── SQLite helpers ────────────────────────────────────────────────

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isFatalOAuthRefreshError(error: unknown): error is FatalOAuthRefreshError {
  return error instanceof AnthropicOAuthRefreshError || error instanceof OpenAIOAuthRefreshError
}

async function loadTokenCache(): Promise<void> {
  const rows = await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<AuthTokenRow>`
        SELECT provider, encrypted_value
        FROM auth_tokens
      `
    }),
  )

  tokenCache.clear()
  for (const row of rows) {
    tokenCache.set(row.provider, row.encrypted_value)
  }
}

async function writeTokenValueToDb(key: string, value: string): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO auth_tokens (provider, encrypted_value, updated_at)
        VALUES (${key}, ${value}, ${Date.now()})
        ON CONFLICT(provider) DO UPDATE SET
          encrypted_value = excluded.encrypted_value,
          updated_at = excluded.updated_at
      `
    }),
  )
}

async function deleteTokenValueFromDb(key: string): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        DELETE FROM auth_tokens
        WHERE provider = ${key}
      `
    }),
  )
}

function queuePersist(effect: () => Promise<void>): void {
  writeQueue = writeQueue.then(effect).catch((error) => {
    logger.warn('Failed to persist auth token state', { error: describeError(error) })
  })
}

function previousKeyKey(provider: SubscriptionProvider): string {
  return `${PREVIOUS_KEY_PREFIX}${provider}`
}

export async function initializeTokenStore(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise
  }

  initializationPromise = loadTokenCache().catch((error) => {
    logger.warn('Failed to initialize token cache from SQLite', {
      error: describeError(error),
    })
    tokenCache.clear()
  })

  await initializationPromise
}

export async function flushTokenStoreForTests(): Promise<void> {
  await writeQueue
}

// ─── Refresh Mutex ──────────────────────────────────────────────────

const refreshLocks = new Map<OAuthProvider, Promise<string | null>>()

// ─── Token Refresh Callbacks ────────────────────────────────────────

type RefreshFn = (
  refreshToken: string,
) => Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }>
const refreshFns = new Map<OAuthProvider, RefreshFn>()

export function registerRefreshFn(provider: OAuthProvider, fn: RefreshFn): void {
  refreshFns.set(provider, fn)
}

// ─── Previous API Key Preservation ──────────────────────────────────

export function storePreviousApiKey(provider: SubscriptionProvider, apiKey: string): void {
  if (!apiKey) return
  const encrypted = encryptString(apiKey)
  const key = previousKeyKey(provider)
  tokenCache.set(key, encrypted)
  queuePersist(() => writeTokenValueToDb(key, encrypted))
}

export function getPreviousApiKey(provider: SubscriptionProvider): string {
  const encrypted = tokenCache.get(previousKeyKey(provider))
  if (!encrypted) return ''
  return decryptString(encrypted)
}

export function clearPreviousApiKey(provider: SubscriptionProvider): void {
  const key = previousKeyKey(provider)
  tokenCache.delete(key)
  queuePersist(() => deleteTokenValueFromDb(key))
}

// ─── Public API ─────────────────────────────────────────────────────

const REFRESH_MARGIN_MS = FIVE_MINUTES_IN_MILLISECONDS

export function storeTokens(provider: 'openrouter', tokens: OpenRouterTokens): void
export function storeTokens(provider: OAuthProvider, tokens: OAuthTokens): void
export function storeTokens(
  provider: SubscriptionProvider,
  tokens: OpenRouterTokens | OAuthTokens,
): void {
  if (!isEncryptionAvailable()) {
    logger.warn('Storing auth tokens without encryption — system keyring unavailable', {
      provider,
    })
  }
  const encrypted = encryptString(JSON.stringify(tokens))
  tokenCache.set(provider, encrypted)
  queuePersist(() => writeTokenValueToDb(provider, encrypted))
  logger.info('Stored tokens', { provider })
}

export function getTokens(provider: SubscriptionProvider): OpenRouterTokens | OAuthTokens | null {
  const encrypted = tokenCache.get(provider)
  if (!encrypted) return null

  const decrypted = decryptString(encrypted)
  if (!decrypted) return null

  try {
    const parsed: unknown = JSON.parse(decrypted)
    if (provider === 'openrouter') {
      const result = safeDecodeUnknown(openRouterTokenSchema, parsed)
      return result.success ? result.data : null
    }
    const result = safeDecodeUnknown(oauthTokenSchema, parsed)
    return result.success ? result.data : null
  } catch {
    logger.warn('Failed to parse stored tokens', { provider })
    return null
  }
}

export function hasStoredUsableAccessToken(provider: SubscriptionProvider): boolean {
  const tokens = getTokens(provider)
  if (!tokens) {
    return false
  }

  if (provider === 'openrouter') {
    return 'apiKey' in tokens && tokens.apiKey.length > 0
  }

  return 'accessToken' in tokens && tokens.accessToken.length > 0 && tokens.expiresAt > Date.now()
}

export function clearTokens(provider: SubscriptionProvider): void {
  tokenCache.delete(provider)
  queuePersist(() => deleteTokenValueFromDb(provider))
  logger.info('Cleared tokens', { provider })
}

/**
 * Get an active access token/API key for the provider.
 * For OpenRouter: returns the permanent API key.
 * For OpenAI/Anthropic: returns the access token, auto-refreshing if near expiry.
 */
export async function getActiveAccessToken(provider: SubscriptionProvider): Promise<string | null> {
  const tokens = getTokens(provider)
  if (!tokens) return null

  if (provider === 'openrouter') {
    return 'apiKey' in tokens ? tokens.apiKey : null
  }

  const oauthProvider: OAuthProvider = provider

  if (!('accessToken' in tokens)) return null
  const oauthTokens = tokens

  const needsRefresh = oauthTokens.expiresAt - Date.now() < REFRESH_MARGIN_MS
  if (!needsRefresh) return oauthTokens.accessToken

  const existing = refreshLocks.get(oauthProvider)
  if (existing) return existing

  const refreshPromise = refreshAccessToken(oauthProvider, oauthTokens)
  refreshLocks.set(oauthProvider, refreshPromise)

  try {
    return await refreshPromise
  } finally {
    refreshLocks.delete(oauthProvider)
  }
}

async function refreshAccessToken(
  provider: OAuthProvider,
  tokens: OAuthTokens,
): Promise<string | null> {
  const refreshFn = refreshFns.get(provider)
  if (!refreshFn) {
    logger.warn('No refresh function registered', { provider })
    return null
  }

  try {
    const refreshed = await refreshFn(tokens.refreshToken)
    storeTokens(provider, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      expiresAt: refreshed.expiresAt,
    })
    logger.info('Token refreshed successfully', { provider })
    return refreshed.accessToken
  } catch (error) {
    if (isFatalOAuthRefreshError(error) && error.fatal) {
      clearTokens(provider)
    }
    logger.warn('Token refresh failed', {
      provider,
      error: describeError(error),
    })
    return null
  }
}
