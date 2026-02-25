import { ollamaTagsResponseSchema } from '@shared/schemas/validation'
import { OLLAMA_DEFAULT_BASE_URL } from '@shared/types/settings'
import { createOllamaChat, OllamaTextModels } from '@tanstack/ai-ollama'
import type { ProviderDefinition } from './provider-definition'

export const ollamaProvider: ProviderDefinition = {
  id: 'ollama',
  displayName: 'Ollama',
  requiresApiKey: false,
  supportsBaseUrl: true,
  supportsSubscription: false,
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
      const raw: unknown = await response.json()
      const result = ollamaTagsResponseSchema.safeParse(raw)
      return result.success ? (result.data.models?.map((m) => m.name) ?? []) : []
    } catch {
      return []
    }
  },
}
