import { createGeminiChat, GeminiTextModels } from '@tanstack/ai-gemini'
import type { ProviderDefinition } from './provider-definition'

export const geminiProvider: ProviderDefinition = {
  id: 'gemini',
  displayName: 'Gemini',
  requiresApiKey: true,
  supportsBaseUrl: false,
  models: GeminiTextModels,
  createAdapter(model, apiKey) {
    return createGeminiChat(model as (typeof GeminiTextModels)[number], apiKey)
  },
}
