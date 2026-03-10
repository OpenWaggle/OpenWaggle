import {
  DOUBLE_FACTOR,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from '@shared/constants/constants'
import type {
  OAuthFlowStatus,
  SubscriptionAccountInfo,
  SubscriptionProvider,
} from '@shared/types/auth'
import { SUBSCRIPTION_PROVIDERS } from '@shared/types/auth'
import { choose } from '@shared/utils/decision'
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
  hasStoredUsableAccessToken,
  registerRefreshFn,
  storePreviousApiKey,
  storeTokens,
} from './token-manager'

const logger = createLogger('auth')
const AUTH_LIFECYCLE_INTERVAL_MS = DOUBLE_FACTOR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND

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
const inFlightOAuthFlows = new Map<SubscriptionProvider, Promise<void>>()
const lifecycleConnectivity = new Map<SubscriptionProvider, boolean>()
let authLifecycleTimer: ReturnType<typeof setInterval> | null = null
let authLifecycleTickInFlight = false

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

// ─── Public API ─────────────────────────────────────────────────────

export async function startOAuth(
  provider: SubscriptionProvider,
  emitStatus: StatusEmitter,
): Promise<void> {
  if (inFlightOAuthFlows.has(provider)) {
    const message = 'A sign-in attempt is already in progress for this provider.'
    emitStatus({ type: 'error', provider, message })
    throw new Error(message)
  }

  const flowPromise = runOAuthFlow(provider, emitStatus).finally(() => {
    inFlightOAuthFlows.delete(provider)
  })
  inFlightOAuthFlows.set(provider, flowPromise)
  await flowPromise
}

export function startAuthLifecycle(emitStatus: StatusEmitter): () => void {
  if (authLifecycleTimer) {
    clearInterval(authLifecycleTimer)
  }

  void runAuthLifecycleTick(emitStatus)
  authLifecycleTimer = setInterval(() => {
    void runAuthLifecycleTick(emitStatus)
  }, AUTH_LIFECYCLE_INTERVAL_MS)
  authLifecycleTimer.unref?.()

  return () => {
    if (authLifecycleTimer) {
      clearInterval(authLifecycleTimer)
      authLifecycleTimer = null
    }
    lifecycleConnectivity.clear()
  }
}

async function runOAuthFlow(
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

    const result = await choose(provider)
      .case('openrouter', async () => {
        const r = await startOpenRouterOAuth()
        storeTokens('openrouter', { apiKey: r.apiKey })
        return { accessToken: r.apiKey }
      })
      .case('openai', async () => {
        const manualCodePromise = createManualCodePromise(provider)
        const r = await startOpenAIOAuth({
          manualCodePromise,
          onAwaitingCode: () => emitStatus({ type: 'awaiting-code', provider }),
          onCodeReceived: () => emitStatus({ type: 'code-received', provider }),
        })
        storeTokens('openai', {
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
          expiresAt: r.expiresAt,
        })
        return { accessToken: r.accessToken }
      })
      .case('anthropic', async () => {
        const manualCodePromise = createManualCodePromise(provider)
        // Anthropic needs a manual code handoff from clipboard/paste.
        emitStatus({ type: 'awaiting-code', provider })
        const r = await startAnthropicOAuth(manualCodePromise, () => {
          emitStatus({ type: 'code-received', provider })
        })
        storeTokens('anthropic', {
          accessToken: r.accessToken,
          refreshToken: r.refreshToken,
          expiresAt: r.expiresAt,
        })
        return { accessToken: r.accessToken }
      })
      .assertComplete()

    applySubscriptionToSettings(provider, result.accessToken)
    lifecycleConnectivity.set(provider, true)
    emitStatus({ type: 'success', provider })
    logger.info('OAuth flow completed', { provider })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown OAuth error'
    logger.warn('OAuth flow failed', { provider, error: message })
    emitStatus({ type: 'error', provider, message })
    throw err
  } finally {
    const pending = pendingCodeHandlers.get(provider)
    if (pending) {
      pendingCodeHandlers.delete(provider)
      pending.reject(new Error('Sign-in flow closed before an authorization code was submitted.'))
    }
  }
}

function createManualCodePromise(provider: SubscriptionProvider): Promise<string> {
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
  // Some providers may complete without consuming manual input fallback.
  void manualCodePromise.catch(() => {})
  return manualCodePromise
}

async function runAuthLifecycleTick(emitStatus: StatusEmitter): Promise<void> {
  if (authLifecycleTickInFlight) return
  authLifecycleTickInFlight = true

  try {
    const settings = getSettings()
    for (const provider of SUBSCRIPTION_PROVIDERS) {
      const config = settings.providers[provider]
      if (config?.authMethod !== 'subscription') {
        lifecycleConnectivity.delete(provider)
        continue
      }

      const connected = hasStoredUsableAccessToken(provider)
      const previous = lifecycleConnectivity.get(provider)

      if (!connected && previous !== false) {
        emitStatus({ type: 'error', provider, message: 'Session expired. Please sign in again.' })
      }
      if (connected && previous === false) {
        emitStatus({ type: 'success', provider })
      }

      lifecycleConnectivity.set(provider, connected)
    }
  } catch (error) {
    logger.warn('auth lifecycle refresh tick failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    authLifecycleTickInFlight = false
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
  const connected = config?.authMethod === 'subscription' && hasStoredUsableAccessToken(provider)

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
