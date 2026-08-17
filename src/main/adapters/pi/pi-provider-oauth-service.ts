import { matchBy } from '@diegogbrisa/ts-match'
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import {
  type OAuthLoginHandlers,
  ProviderOAuthService,
  type ProviderOAuthServiceShape,
} from '../../ports/provider-oauth-service'

function createModelRuntime() {
  return ModelRuntime.create()
}

function listOAuthProviders(modelRuntime: ModelRuntime) {
  return modelRuntime
    .getProviders()
    .filter((provider) => provider.auth.oauth !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id))
}

function notifyOAuthHandlers(event: AuthEvent, handlers: OAuthLoginHandlers) {
  return matchBy(event, 'type')
    .with('auth_url', (event) => handlers.onAuthUrl(event.url, false))
    .with('device_code', (event) =>
      handlers.onDeviceCode({
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
        ...(event.expiresInSeconds === undefined
          ? {}
          : { expiresInSeconds: event.expiresInSeconds }),
      }),
    )
    .with('info', 'progress', () => handlers.onProgress())
    .exhaustive()
}

function respondToOAuthPrompt(prompt: AuthPrompt, handlers: OAuthLoginHandlers) {
  return matchBy(prompt, 'type')
    .with('select', async (prompt) => {
      const response = await handlers.onSelect({
        message: prompt.message,
        options: prompt.options.map((option) => ({ id: option.id, label: option.label })),
      })
      if (response === undefined) {
        throw new Error('OAuth selection was canceled.')
      }
      return response
    })
    .with('manual_code', () => handlers.onManualCodeInput())
    .with('text', 'secret', () => handlers.onPrompt())
    .exhaustive()
}

function toError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}

export const PiProviderOAuthLive = Layer.succeed(
  ProviderOAuthService,
  ProviderOAuthService.of({
    listProviders: () =>
      Effect.tryPromise({
        try: async () =>
          listOAuthProviders(await createModelRuntime()).map((provider) => provider.id),
        catch: toError,
      }),

    login: (provider, handlers) =>
      Effect.tryPromise({
        try: async () => {
          const modelRuntime = await createModelRuntime()
          if (!modelRuntime.getProvider(provider)?.auth.oauth) {
            throw new Error(`Unknown OAuth provider: ${provider}`)
          }

          await modelRuntime.login(provider, 'oauth', {
            signal: handlers.signal,
            notify: (event) => notifyOAuthHandlers(event, handlers),
            prompt: (prompt) => respondToOAuthPrompt(prompt, handlers),
          })
        },
        catch: toError,
      }),

    logout: (provider) =>
      Effect.tryPromise({
        try: async () => (await createModelRuntime()).logout(provider),
        catch: toError,
      }),

    isConnected: (provider) =>
      Effect.tryPromise({
        try: async () => {
          const modelRuntime = await createModelRuntime()
          const credential = (await modelRuntime.listCredentials()).find(
            (credential) => credential.providerId === provider,
          )
          return credential?.type === 'oauth' && Boolean(await modelRuntime.getAuth(provider))
        },
        catch: toError,
      }),

    getAccountInfo: (provider) =>
      Effect.tryPromise({
        try: async () => {
          const modelRuntime = await createModelRuntime()
          const credential = (await modelRuntime.listCredentials()).find(
            (credential) => credential.providerId === provider,
          )
          const connected =
            credential?.type === 'oauth' && Boolean(await modelRuntime.getAuth(provider))
          const providerName = modelRuntime.getProvider(provider)?.name
          return {
            provider,
            connected,
            label: connected ? (providerName ?? 'Connected') : 'Not connected',
          }
        },
        catch: toError,
      }),
  } satisfies ProviderOAuthServiceShape),
)
