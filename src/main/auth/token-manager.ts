import { FIVE_MINUTES_IN_MILLISECONDS } from '@shared/constants/constants'
import type { SubscriptionProvider } from '@shared/types/auth'
import Store from 'electron-store'
import { z } from 'zod'
import { createLogger } from '../logger'
import { decryptString, encryptString, isEncryptionAvailable } from '../store/encryption'

const logger = createLogger('token-manager')

// ─── Token Schemas ──────────────────────────────────────────────────

const openRouterTokenSchema = z.object({
  apiKey: z.string(),
})

const oauthTokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
})

type OpenRouterTokens = z.infer<typeof openRouterTokenSchema>
type OAuthTokens = z.infer<typeof oauthTokenSchema>

// Providers that use OAuth token refresh (not OpenRouter — permanent key)
type OAuthProvider = 'openai' | 'anthropic'

// ─── Storage ────────────────────────────────────────────────────────

interface TokenStoreSchema {
  openrouter?: string // encrypted JSON
  openai?: string
  anthropic?: string
  // Previous API keys (preserved before subscription switch)
  'prev-key:openrouter'?: string
  'prev-key:openai'?: string
  'prev-key:anthropic'?: string
}

const store = new Store<TokenStoreSchema>({
  name: 'auth-tokens',
  defaults: {},
})

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
  const key = `prev-key:${provider}` as keyof TokenStoreSchema
  store.set(key, encryptString(apiKey))
}

export function getPreviousApiKey(provider: SubscriptionProvider): string {
  const key = `prev-key:${provider}` as keyof TokenStoreSchema
  const encrypted = store.get(key)
  if (!encrypted) return ''
  return decryptString(encrypted)
}

export function clearPreviousApiKey(provider: SubscriptionProvider): void {
  const key = `prev-key:${provider}` as keyof TokenStoreSchema
  store.delete(key)
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
  const json = JSON.stringify(tokens)
  const encrypted = encryptString(json)
  store.set(provider, encrypted)
  logger.info('Stored tokens', { provider })
}

export function getTokens(provider: SubscriptionProvider): OpenRouterTokens | OAuthTokens | null {
  const encrypted = store.get(provider)
  if (!encrypted) return null

  const decrypted = decryptString(encrypted)
  if (!decrypted) return null

  try {
    const parsed: unknown = JSON.parse(decrypted)
    if (provider === 'openrouter') {
      const result = openRouterTokenSchema.safeParse(parsed)
      return result.success ? result.data : null
    }
    const result = oauthTokenSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    logger.warn('Failed to parse stored tokens', { provider })
    return null
  }
}

export function hasTokens(provider: SubscriptionProvider): boolean {
  return getTokens(provider) !== null
}

export function clearTokens(provider: SubscriptionProvider): void {
  store.delete(provider)
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

  // OpenRouter has a permanent key — no refresh needed
  if (provider === 'openrouter') {
    return 'apiKey' in tokens ? tokens.apiKey : null
  }

  // After the openrouter check, provider is narrowed to OAuthProvider
  const oauthProvider: OAuthProvider = provider

  // OAuth tokens — check expiry
  if (!('accessToken' in tokens)) return null
  const oauthTokens = tokens

  const needsRefresh = oauthTokens.expiresAt - Date.now() < REFRESH_MARGIN_MS
  if (!needsRefresh) return oauthTokens.accessToken

  // Serialize refresh to prevent concurrent races
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
  } catch (err) {
    logger.warn('Token refresh failed', {
      provider,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
