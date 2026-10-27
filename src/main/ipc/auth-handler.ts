import type { OAuthAccountInfo, OAuthFlowStatus, OAuthProvider } from '@shared/types/auth'
import { isOAuthProvider } from '@shared/types/auth'
import * as Effect from 'effect/Effect'
import { recordUsageStatisticsObservation } from '../application/usage-statistics-recording'
import {
  cancelOAuth,
  disconnect,
  getAccountInfo,
  startAuthLifecycle,
  startOAuth,
  submitCode,
} from '../auth'
import { getAllBrowserWindows } from '../desktop-ui'
import { ProviderAuthService } from '../ports/provider-auth-service'
import { ProviderOAuthService } from '../ports/provider-oauth-service'
import { runAppEffect } from '../runtime'
import { typedHandle } from './typed-ipc'

/** More providers than Pi offers OAuth for is not a real request. */
const MAX_ACCOUNT_INFO_PROVIDERS = 64

function broadcastOAuthStatus(status: OAuthFlowStatus) {
  if (status.type === 'success') {
    void runAppEffect(recordUsageStatisticsObservation({ kind: 'provider-connected' }))
  }
  for (const window of getAllBrowserWindows()) {
    window.webContents.send('auth:oauth-status', status)
  }
}

function validateOAuthProvider(provider: string) {
  return Effect.gen(function* () {
    if (!isOAuthProvider(provider)) {
      return yield* Effect.fail(new Error(`Invalid OAuth provider: ${provider}`))
    }

    const oauthService = yield* ProviderOAuthService
    const providers = yield* oauthService.listProviders()
    if (!providers.includes(provider)) {
      return yield* Effect.fail(new Error(`Provider does not support OAuth: ${provider}`))
    }

    return provider
  })
}

let stopAuthLifecycle: (() => void) | null = null

export function registerAuthHandlers(): void {
  if (stopAuthLifecycle) stopAuthLifecycle()
  stopAuthLifecycle = startAuthLifecycle(broadcastOAuthStatus)

  typedHandle('auth:start-oauth', (_event, provider: string) =>
    Effect.gen(function* () {
      const validated = yield* validateOAuthProvider(provider)
      yield* Effect.promise(() => startOAuth(validated, broadcastOAuthStatus))
    }),
  )

  typedHandle('auth:submit-code', (_event, provider: string, code: string) =>
    Effect.gen(function* () {
      const validated = yield* validateOAuthProvider(provider)
      submitCode(validated, code)
    }),
  )

  typedHandle('auth:cancel-oauth', (_event, provider: string) =>
    Effect.gen(function* () {
      const validated = yield* validateOAuthProvider(provider)
      yield* Effect.promise(() => cancelOAuth(validated, broadcastOAuthStatus))
    }),
  )

  typedHandle('auth:set-api-key', (_event, provider: string, apiKey: string) =>
    Effect.gen(function* () {
      const providerAuth = yield* ProviderAuthService
      yield* providerAuth.setApiKey(provider, apiKey)
      if (apiKey.trim()) yield* recordUsageStatisticsObservation({ kind: 'provider-connected' })
    }),
  )

  typedHandle('auth:disconnect', (_event, provider: string) =>
    Effect.gen(function* () {
      const validated = yield* validateOAuthProvider(provider)
      yield* Effect.promise(() => disconnect(validated))
      broadcastOAuthStatus({ type: 'idle' })
    }),
  )

  typedHandle('auth:get-account-info', (_event, provider: string) =>
    Effect.gen(function* () {
      const validated = yield* validateOAuthProvider(provider)
      return yield* Effect.promise(() => getAccountInfo(validated))
    }),
  )

  typedHandle('auth:get-account-infos', (_event, providers: unknown) =>
    Effect.gen(function* () {
      if (!Array.isArray(providers) || providers.length > MAX_ACCOUNT_INFO_PROVIDERS) {
        return yield* Effect.fail(new Error('Providers must be a short list of OAuth providers.'))
      }
      const validated: OAuthProvider[] = []
      for (const provider of providers) {
        if (typeof provider !== 'string') {
          return yield* Effect.fail(new Error('OAuth providers must be strings.'))
        }
        validated.push(yield* validateOAuthProvider(provider))
      }
      const unique = [...new Set(validated)]
      const settled = yield* Effect.promise(() =>
        Promise.allSettled(unique.map((provider) => getAccountInfo(provider))),
      )
      // One provider's failure leaves only its account out, as separate reads did.
      const result: Partial<Record<OAuthProvider, OAuthAccountInfo>> = {}
      settled.forEach((outcome, index) => {
        const provider = unique[index]
        if (provider && outcome.status === 'fulfilled') result[provider] = outcome.value
      })
      return result
    }),
  )
}
