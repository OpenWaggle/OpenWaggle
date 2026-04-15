/**
 * ProviderService adapter — wraps the provider registry singleton.
 *
 * Bridges the legacy `providerRegistry` singleton into the ProviderService
 * Effect Context.Tag port. Includes `createChatAdapter()` that returns
 * the domain-owned `ChatAdapter` branded type.
 */

import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { ProviderLookupError } from '../errors'
import { wrapChatAdapter } from '../ports/chat-adapter-type'
import { type ProviderCapabilities, ProviderService } from '../ports/provider-service'
import type { ProviderDefinition } from '../providers/provider-definition'
import { providerRegistry } from '../providers/registry'

function toCapabilities(def: ProviderDefinition): ProviderCapabilities {
  return {
    id: def.id,
    displayName: def.displayName,
    requiresApiKey: def.requiresApiKey,
    supportsBaseUrl: def.supportsBaseUrl,
    supportsSubscription: def.supportsSubscription,
    supportsDynamicModelFetch: def.supportsDynamicModelFetch,
    models: def.models,
    testModel: def.testModel,
    apiKeyManagementUrl: def.apiKeyManagementUrl,
    getContextWindow: def.getContextWindow?.bind(def),
  }
}

export const ProviderServiceLive = Layer.succeed(
  ProviderService,
  ProviderService.of({
    get: (providerId) =>
      Effect.sync(() => {
        const def = providerRegistry.get(providerId)
        return def ? toCapabilities(def) : undefined
      }),

    getAll: () => Effect.sync(() => providerRegistry.getAll().map(toCapabilities)),

    getProviderForModel: (modelId) =>
      Effect.sync(() => providerRegistry.getProviderForModel(modelId)).pipe(
        Effect.flatMap((provider) =>
          provider
            ? Effect.succeed(toCapabilities(provider))
            : Effect.fail(new ProviderLookupError({ modelId })),
        ),
      ),

    isKnownModel: (modelId) => Effect.sync(() => providerRegistry.isKnownModel(modelId)),

    createChatAdapter: (model, apiKey, baseUrl, authMethod) =>
      Effect.sync(() => providerRegistry.getProviderForModel(model)).pipe(
        Effect.flatMap((provider) => {
          if (!provider) {
            return Effect.fail(new ProviderLookupError({ modelId: model }))
          }
          const vendorAdapter = provider.createAdapter(model, apiKey, baseUrl, authMethod)
          return Effect.succeed(wrapChatAdapter(vendorAdapter))
        }),
      ),

    indexModels: (modelIds, providerId) =>
      Effect.sync(() => {
        const provider = providerRegistry.get(providerId)
        if (provider) {
          providerRegistry.indexModels(modelIds, provider)
        }
      }).pipe(Effect.flatMap(() => Effect.void)),

    fetchModels: (providerId, baseUrl, apiKey, authMethod) => {
      const emptyModels: readonly string[] = []
      return Effect.promise(async () => {
        try {
          const provider = providerRegistry.get(providerId)
          if (!provider?.supportsDynamicModelFetch || !provider.fetchModels) {
            return emptyModels
          }
          return provider.fetchModels(baseUrl, apiKey, authMethod)
        } catch {
          return emptyModels
        }
      })
    },
  }),
)
