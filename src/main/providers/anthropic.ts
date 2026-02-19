import { ANTHROPIC_MODELS, createAnthropicChat } from '@tanstack/ai-anthropic'
import type { ProviderDefinition } from './provider-definition'

export const anthropicProvider: ProviderDefinition = {
  id: 'anthropic',
  displayName: 'Anthropic',
  requiresApiKey: true,
  apiKeyManagementUrl: 'https://platform.claude.com/settings/keys',
  supportsBaseUrl: false,
  models: ANTHROPIC_MODELS,
  testModel: 'claude-haiku-4-5',
  createAdapter(model, apiKey) {
    return createAnthropicChat(model as (typeof ANTHROPIC_MODELS)[number], apiKey)
  },
}
