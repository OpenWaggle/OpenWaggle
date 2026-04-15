import { SupportedModelId } from '@shared/types/brand'
import { generateDisplayName } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { ProviderService } from '../ports/provider-service'
import { typedHandle } from './typed-ipc'

export function registerProvidersHandlers(): void {
  typedHandle('providers:get-models', () =>
    Effect.gen(function* () {
      const providerSvc = yield* ProviderService
      const providers = yield* providerSvc.getAll()
      return [...providers].map((p) => ({
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
          contextWindow: p.getContextWindow?.(m)?.contextTokens,
        })),
      }))
    }),
  )

  typedHandle(
    'providers:fetch-models',
    (
      _event,
      providerId: Provider,
      baseUrl?: string,
      apiKey?: string,
      authMethod?: 'api-key' | 'subscription',
    ) =>
      Effect.gen(function* () {
        const providerSvc = yield* ProviderService
        const models = yield* providerSvc.fetchModels(providerId, baseUrl, apiKey, authMethod)
        if (models.length > 0) {
          yield* providerSvc.indexModels(models, providerId)
        }
        const providerInfo = yield* providerSvc.get(providerId)
        return [...models].map((m) => ({
          id: SupportedModelId(m),
          name: generateDisplayName(m),
          provider: providerId,
          contextWindow: providerInfo?.getContextWindow?.(m)?.contextTokens,
        }))
      }),
  )
}
