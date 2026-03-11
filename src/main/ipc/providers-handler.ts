import { SupportedModelId } from '@shared/types/brand'
import { generateDisplayName } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { providerRegistry } from '../providers'
import { typedHandle } from './typed-ipc'

export function registerProvidersHandlers(): void {
  typedHandle('providers:get-models', () =>
    Effect.sync(() =>
      providerRegistry.getAll().map((p) => ({
        provider: p.id,
        displayName: p.displayName,
        requiresApiKey: p.requiresApiKey,
        apiKeyManagementUrl: p.apiKeyManagementUrl,
        supportsBaseUrl: p.supportsBaseUrl,
        supportsSubscription: p.supportsSubscription,
        supportsDynamicModelFetch: p.supportsDynamicModelFetch,
        models: p.models.map((m) => ({
          id: SupportedModelId(m),
          name: generateDisplayName(m),
          provider: p.id,
        })),
      })),
    ),
  )

  typedHandle(
    'providers:fetch-models',
    (_event, providerId: Provider, baseUrl?: string, apiKey?: string) =>
      Effect.gen(function* () {
        const provider = providerRegistry.get(providerId)
        if (!provider?.supportsDynamicModelFetch || !provider.fetchModels) return []

        const models = yield* Effect.promise(
          () => provider.fetchModels?.(baseUrl, apiKey) ?? Promise.resolve([]),
        )
        return models.map((m) => ({
          id: SupportedModelId(m),
          name: generateDisplayName(m),
          provider: providerId,
        }))
      }),
  )
}
