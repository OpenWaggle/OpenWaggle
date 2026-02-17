import { createOllamaChat, OllamaTextModels } from '@tanstack/ai-ollama'
import type { ProviderDefinition } from './provider-definition'

export const ollamaProvider: ProviderDefinition = {
  id: 'ollama',
  displayName: 'Ollama',
  requiresApiKey: false,
  supportsBaseUrl: true,
  models: OllamaTextModels,
  createAdapter(model, _apiKey, baseUrl) {
    return createOllamaChat(model, baseUrl ?? 'http://localhost:11434')
  },
  async fetchModels(baseUrl) {
    const host = baseUrl ?? 'http://localhost:11434'
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
