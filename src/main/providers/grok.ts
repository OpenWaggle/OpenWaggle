import { createGrokText, GROK_CHAT_MODELS } from '@tanstack/ai-grok'
import type { ProviderDefinition } from './provider-definition'

export const grokProvider: ProviderDefinition = {
  id: 'grok',
  displayName: 'Grok',
  requiresApiKey: true,
  supportsBaseUrl: false,
  models: GROK_CHAT_MODELS,
  createAdapter(model, apiKey) {
    return createGrokText(model as (typeof GROK_CHAT_MODELS)[number], apiKey)
  },
}
