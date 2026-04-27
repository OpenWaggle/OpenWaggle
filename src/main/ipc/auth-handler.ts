import type { OAuthFlowStatus, OAuthProvider } from '@shared/types/auth'
import { isOAuthProvider } from '@shared/types/auth'
import * as Effect from 'effect/Effect'
import { BrowserWindow } from 'electron'
import {
  cancelOAuth,
  disconnect,
  getAccountInfo,
  startAuthLifecycle,
  startOAuth,
  submitCode,
} from '../auth'
import { ProviderAuthService } from '../ports/provider-auth-service'
import { ProviderOAuthService } from '../ports/provider-oauth-service'
import { typedHandle } from './typed-ipc'

function broadcastOAuthStatus(status: OAuthFlowStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('auth:oauth-status', status)
  }
}

function validateOAuthProvider(
  provider: string,
): Effect.Effect<OAuthProvider, Error, ProviderOAuthService> {
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
}
