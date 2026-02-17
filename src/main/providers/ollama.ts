import { OLLAMA_DEFAULT_BASE_URL } from '@shared/types/settings'
import { createOllamaChat, OllamaTextModels } from '@tanstack/ai-ollama'
import type { ProviderDefinition } from './provider-definition'

export const ollamaProvider: ProviderDefinition = {
  id: 'ollama',
  displayName: 'Ollama',
  requiresApiKey: false,
  supportsBaseUrl: true,
  models: OllamaTextModels,
  testModel: OllamaTextModels[0] ?? 'llama3.2',
  createAdapter(model, _apiKey, baseUrl) {
    return createOllamaChat(model, baseUrl ?? OLLAMA_DEFAULT_BASE_URL)
  },
  async fetchModels(baseUrl) {
    const host = baseUrl ?? OLLAMA_DEFAULT_BASE_URL
    try {
      const response = await fetch(`${host}/api/tags`)
      if (!response.ok) return []
      const data = (await response.json()) as { models?: Array<{ name: string }> }
      return data.models?.map((m) => m.name) ?? []
    } catch {
      return []
    }
  },
}
