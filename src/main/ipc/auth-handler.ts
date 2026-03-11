import type { OAuthFlowStatus, SubscriptionProvider } from '@shared/types/auth'
import { isSubscriptionProvider } from '@shared/types/auth'
import * as Effect from 'effect/Effect'
import { BrowserWindow } from 'electron'
import { disconnect, getAccountInfo, startAuthLifecycle, startOAuth, submitCode } from '../auth'
import { typedHandle } from './typed-ipc'

function broadcastOAuthStatus(status: OAuthFlowStatus): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('auth:oauth-status', status)
  }
}

function validateSubscriptionProvider(
  provider: string,
): Effect.Effect<SubscriptionProvider, Error> {
  if (!isSubscriptionProvider(provider)) {
    return Effect.fail(new Error(`Invalid subscription provider: ${provider}`))
  }
  return Effect.succeed(provider)
}

let stopAuthLifecycle: (() => void) | null = null

export function registerAuthHandlers(): void {
  if (stopAuthLifecycle) stopAuthLifecycle()
  stopAuthLifecycle = startAuthLifecycle(broadcastOAuthStatus)

  typedHandle('auth:start-oauth', (_event, provider: string) =>
    Effect.gen(function* () {
      const validated = yield* validateSubscriptionProvider(provider)
      yield* Effect.promise(() => startOAuth(validated, broadcastOAuthStatus))
    }),
  )

  typedHandle('auth:submit-code', (_event, provider: string, code: string) =>
    Effect.gen(function* () {
      const validated = yield* validateSubscriptionProvider(provider)
      submitCode(validated, code)
    }),
  )

  typedHandle('auth:disconnect', (_event, provider: string) =>
    Effect.gen(function* () {
      const validated = yield* validateSubscriptionProvider(provider)
      disconnect(validated)
      broadcastOAuthStatus({ type: 'idle' })
    }),
  )

  typedHandle('auth:get-account-info', (_event, provider: string) =>
    Effect.gen(function* () {
      const validated = yield* validateSubscriptionProvider(provider)
      return yield* Effect.promise(() => getAccountInfo(validated))
    }),
  )
}
