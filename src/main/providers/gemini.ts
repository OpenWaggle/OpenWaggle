import { includes } from '@shared/utils/validation'
import { createGeminiChat, GeminiTextModels } from '@tanstack/ai-gemini'
import type { ProviderDefinition } from './provider-definition'

export const geminiProvider: ProviderDefinition = {
  id: 'gemini',
  displayName: 'Gemini',
  requiresApiKey: true,
  apiKeyManagementUrl: 'https://aistudio.google.com/app/apikey',
  supportsBaseUrl: false,
  supportsSubscription: false,
  supportsDynamicModelFetch: false,
  models: GeminiTextModels,
  testModel: 'gemini-2.0-flash-lite',
  supportsAttachment: (kind) => kind === 'image' || kind === 'pdf',
  createAdapter(model, apiKey) {
    if (!includes(GeminiTextModels, model)) throw new Error(`Unknown Gemini model: ${model}`)
    if (!apiKey) throw new Error('Gemini API key is required')
    return createGeminiChat(model, apiKey)
  },
}
