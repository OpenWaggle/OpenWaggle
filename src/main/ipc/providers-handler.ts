import { generateDisplayName } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import { providerRegistry } from '../providers'
import { typedHandle } from './typed-ipc'

export function registerProvidersHandlers(): void {
  typedHandle('providers:get-models', () => {
    return providerRegistry.getAll().map((p) => ({
      provider: p.id,
      displayName: p.displayName,
      requiresApiKey: p.requiresApiKey,
      apiKeyManagementUrl: p.apiKeyManagementUrl,
      supportsBaseUrl: p.supportsBaseUrl,
      supportsSubscription: p.supportsSubscription,
      models: p.models.map((m) => ({
        id: m,
        name: generateDisplayName(m),
        provider: p.id,
      })),
    }))
  })

  typedHandle(
    'providers:fetch-models',
    async (_event, providerId: Provider, baseUrl?: string, apiKey?: string) => {
      const provider = providerRegistry.get(providerId)
      if (!provider?.fetchModels) return []

      const models = await provider.fetchModels(baseUrl, apiKey)
      return models.map((m) => ({
        id: m,
        name: generateDisplayName(m),
        provider: providerId,
      }))
    },
  )
}
