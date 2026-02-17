import { ANTHROPIC_MODELS, createAnthropicChat } from '@tanstack/ai-anthropic'
import type { ProviderDefinition } from './provider-definition'

export const anthropicProvider: ProviderDefinition = {
  id: 'anthropic',
  displayName: 'Anthropic',
  requiresApiKey: true,
  supportsBaseUrl: false,
  models: ANTHROPIC_MODELS,
  createAdapter(model, apiKey) {
    return createAnthropicChat(model as (typeof ANTHROPIC_MODELS)[number], apiKey)
  },
}
