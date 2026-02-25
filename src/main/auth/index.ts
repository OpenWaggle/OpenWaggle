import type {
  OAuthFlowStatus,
  SubscriptionAccountInfo,
  SubscriptionProvider,
} from '@shared/types/auth'
import { createLogger } from '../logger'
import { getSettings, updateSettings } from '../store/settings'
import { refreshAnthropicToken, startAnthropicOAuth } from './flows/anthropic-oauth'
import { refreshOpenAIToken, startOpenAIOAuth } from './flows/openai-oauth'
import { startOpenRouterOAuth } from './flows/openrouter-oauth'
import {
  clearPreviousApiKey,
  clearTokens,
  getActiveAccessToken,
  getPreviousApiKey,
  registerRefreshFn,
  storePreviousApiKey,
  storeTokens,
} from './token-manager'

const logger = createLogger('auth')

// Register refresh functions for token-manager
registerRefreshFn('openai', refreshOpenAIToken)
registerRefreshFn('anthropic', async (rt) => {
  const result = await refreshAnthropicToken(rt)
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt,
  }
})

type StatusEmitter = (status: OAuthFlowStatus) => void

// ─── Pending Code Submission (for Anthropic) ──────────────────────

interface PendingCodeHandler {
  readonly resolve: (code: string) => void
  readonly reject: (error: Error) => void
}

const pendingCodeHandlers = new Map<SubscriptionProvider, PendingCodeHandler>()

/**
 * Called from the IPC handler when the user submits an auth code via the UI.
 */
export function submitCode(provider: SubscriptionProvider, code: string): void {
  const handler = pendingCodeHandlers.get(provider)
  if (handler) {
    pendingCodeHandlers.delete(provider)
    handler.resolve(code)
  }
}

// ─── OAuth Flow Registry ────────────────────────────────────────────

interface OAuthFlowResult {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly expiresAt?: number
}

// ─── Public API ─────────────────────────────────────────────────────

export async function startOAuth(
  provider: SubscriptionProvider,
  emitStatus: StatusEmitter,
): Promise<void> {
  emitStatus({ type: 'in-progress', provider })

  try {
    // Preserve the current manual API key before overwriting
    const settings = getSettings()
    const currentKey = settings.providers[provider]?.apiKey
    if (currentKey) {
      storePreviousApiKey(provider, currentKey)
    }

    let result: OAuthFlowResult

    if (provider === 'openrouter') {
      const r = await startOpenRouterOAuth()
      storeTokens('openrouter', { apiKey: r.apiKey })
      result = { accessToken: r.apiKey }
    } else if (provider === 'openai') {
      const r = await startOpenAIOAuth()
      storeTokens('openai', {
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        expiresAt: r.expiresAt,
      })
      result = { accessToken: r.accessToken }
    } else {
      // Anthropic — emit 'awaiting-code' so the UI shows the paste input
      emitStatus({ type: 'awaiting-code', provider })

      const existingPending = pendingCodeHandlers.get(provider)
      if (existingPending) {
        pendingCodeHandlers.delete(provider)
        existingPending.reject(
          new Error('A new sign-in attempt was started before the previous one completed.'),
        )
      }

      const manualCodePromise = new Promise<string>((resolve, reject) => {
        pendingCodeHandlers.set(provider, { resolve, reject })
      })

      const r = await startAnthropicOAuth(
        manualCodePromise.finally(() => {
          pendingCodeHandlers.delete(provider)
        }),
        () => {
          emitStatus({ type: 'code-received', provider })
        },
      )
      storeTokens('anthropic', {
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        expiresAt: r.expiresAt,
      })
      result = { accessToken: r.accessToken }
    }

    applySubscriptionToSettings(provider, result.accessToken)

    emitStatus({ type: 'success', provider })
    logger.info('OAuth flow completed', { provider })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown OAuth error'
    logger.warn('OAuth flow failed', { provider, error: message })
    emitStatus({ type: 'error', provider, message })
    pendingCodeHandlers.delete(provider)
    throw err
  }
}

export function disconnect(provider: SubscriptionProvider): void {
  clearTokens(provider)

  const settings = getSettings()
  const existing = settings.providers[provider]

  // Restore the user's previous manually-entered API key if available
  const previousKey = getPreviousApiKey(provider)
  clearPreviousApiKey(provider)

  if (existing) {
    updateSettings({
      providers: {
        [provider]: {
          apiKey: previousKey,
          baseUrl: existing.baseUrl,
          enabled: previousKey ? existing.enabled : false,
          authMethod: 'api-key',
        },
      },
    })
  }

  logger.info('Disconnected subscription', { provider })
}

export async function getAccountInfo(
  provider: SubscriptionProvider,
): Promise<SubscriptionAccountInfo> {
  const settings = getSettings()
  const config = settings.providers[provider]
  const connected =
    config?.authMethod === 'subscription' && (await getActiveAccessToken(provider)) !== null

  return {
    provider,
    connected,
    label: connected ? 'Connected' : 'Not connected',
    disconnectedReason:
      !connected && config?.authMethod === 'subscription'
        ? 'Session expired. Please sign in again.'
        : undefined,
  }
}

/**
 * Get an active API key or access token for a subscription provider.
 * Used at agent resolution time to get a fresh token.
 */
export async function getActiveApiKey(provider: SubscriptionProvider): Promise<string | null> {
  return getActiveAccessToken(provider)
}

function applySubscriptionToSettings(provider: SubscriptionProvider, apiKey: string): void {
  const settings = getSettings()
  const existing = settings.providers[provider]
  updateSettings({
    providers: {
      [provider]: {
        apiKey,
        baseUrl: existing?.baseUrl,
        enabled: true,
        authMethod: 'subscription',
      },
    },
  })
}
