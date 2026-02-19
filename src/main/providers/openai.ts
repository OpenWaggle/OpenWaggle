import { createOpenaiChat, OPENAI_CHAT_MODELS } from '@tanstack/ai-openai'
import type { ProviderDefinition } from './provider-definition'

export const openaiProvider: ProviderDefinition = {
  id: 'openai',
  displayName: 'OpenAI',
  requiresApiKey: true,
  apiKeyManagementUrl: 'https://platform.openai.com/api-keys',
  supportsBaseUrl: false,
  models: OPENAI_CHAT_MODELS,
  testModel: 'gpt-4.1-nano',
  createAdapter(model, apiKey) {
    return createOpenaiChat(model as (typeof OPENAI_CHAT_MODELS)[number], apiKey)
  },
}
