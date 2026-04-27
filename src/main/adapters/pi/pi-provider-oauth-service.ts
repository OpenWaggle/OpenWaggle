import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import {
  ProviderOAuthService,
  type ProviderOAuthServiceShape,
} from '../../ports/provider-oauth-service'
import { createPiRuntimeAuthStorage, reloadPiProviderCatalog } from './pi-provider-catalog'

function getOAuthProvider(providerId: string) {
  return createPiRuntimeAuthStorage()
    .getOAuthProviders()
    .find((provider) => provider.id === providerId)
}

export const PiProviderOAuthLive = Layer.succeed(
  ProviderOAuthService,
  ProviderOAuthService.of({
    listProviders: () =>
      Effect.sync(() =>
        createPiRuntimeAuthStorage()
          .getOAuthProviders()
          .map((provider) => provider.id)
          .sort((left, right) => left.localeCompare(right)),
      ),

    login: (provider, handlers) =>
      Effect.tryPromise({
        try: async () => {
          const authStorage = createPiRuntimeAuthStorage()
          const oauthProvider = authStorage
            .getOAuthProviders()
            .find((entry) => entry.id === provider)
          if (!oauthProvider) {
            throw new Error(`Unknown OAuth provider: ${provider}`)
          }

          await authStorage.login(provider, {
            onAuth: (info) => {
              handlers.onAuthUrl(info.url, oauthProvider.usesCallbackServer === true)
            },
            onPrompt: handlers.onPrompt,
            onProgress: handlers.onProgress,
            onManualCodeInput: handlers.onManualCodeInput,
            signal: handlers.signal,
          })
          reloadPiProviderCatalog()
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),

    logout: (provider) =>
      Effect.sync(() => {
        createPiRuntimeAuthStorage().logout(provider)
        reloadPiProviderCatalog()
      }),

    isConnected: (provider) =>
      Effect.tryPromise({
        try: async () => {
          const authStorage = createPiRuntimeAuthStorage()
          if (authStorage.get(provider)?.type !== 'oauth') {
            return false
          }
          return Boolean(await authStorage.getApiKey(provider))
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),

    getAccountInfo: (provider) =>
      Effect.tryPromise({
        try: async () => {
          const authStorage = createPiRuntimeAuthStorage()
          const connected =
            authStorage.get(provider)?.type === 'oauth' &&
            Boolean(await authStorage.getApiKey(provider))
          const providerName = getOAuthProvider(provider)?.name
          return {
            provider,
            connected,
            label: connected ? (providerName ?? 'Connected') : 'Not connected',
          }
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
  } satisfies ProviderOAuthServiceShape),
)
