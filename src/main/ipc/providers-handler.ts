import type { ModelDisplayInfo, ProviderInfo } from '@shared/types/llm'
import { generateDisplayName } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import { ipcMain } from 'electron'
import { providerRegistry } from '../providers'

export function registerProvidersHandlers(): void {
  ipcMain.handle('providers:get-models', (): ProviderInfo[] => {
    return providerRegistry.getAll().map((p) => ({
      provider: p.id,
      displayName: p.displayName,
      requiresApiKey: p.requiresApiKey,
      supportsBaseUrl: p.supportsBaseUrl,
      models: p.models.map((m) => ({
        id: m,
        name: generateDisplayName(m),
        provider: p.id,
      })),
    }))
  })

  ipcMain.handle(
    'providers:fetch-models',
    async (
      _event,
      providerId: Provider,
      baseUrl?: string,
      apiKey?: string,
    ): Promise<ModelDisplayInfo[]> => {
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
