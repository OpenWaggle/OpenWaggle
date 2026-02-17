import type { Settings } from '@shared/types/settings'
import { chat } from '@tanstack/ai'
import { ipcMain } from 'electron'
import { providerRegistry } from '../providers'
import { getSettings, updateSettings } from '../store/settings'

async function testProviderApiKey(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<boolean> {
  const provider = providerRegistry.get(providerId)
  if (!provider) return false

  if (!provider.requiresApiKey) {
    // For Ollama: test connectivity by fetching model list
    if (provider.fetchModels) {
      const models = await provider.fetchModels(baseUrl)
      return models.length > 0
    }
    return true
  }

  try {
    // Use the last model in the list (typically cheapest)
    const testModel = provider.models[provider.models.length - 1]
    if (!testModel) return false
    const adapter = provider.createAdapter(testModel, apiKey, baseUrl)
    const stream = chat({ adapter, messages: [{ role: 'user', content: 'Hi' }] })
    for await (const _ of stream) {
      break // first chunk confirms the key works
    }
    return true
  } catch {
    return false
  }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:update', (_event, partial: Partial<Settings>) => {
    updateSettings(partial)
  })

  ipcMain.handle(
    'settings:test-api-key',
    async (_event, provider: string, apiKey: string, baseUrl?: string) => {
      return testProviderApiKey(provider, apiKey, baseUrl)
    },
  )
}
