import { includes } from '@shared/utils/validation'
import { createOpenRouterText } from '@tanstack/ai-openrouter'
import type { ProviderDefinition } from './provider-definition'

/**
 * Curated list of popular OpenRouter models for the UI.
 * OpenRouter accepts any model ID, but the full list (300+) isn't exported
 * from @tanstack/ai-openrouter's public API.
 */
const OPENROUTER_UI_MODELS = [
  'anthropic/claude-opus-4',
  'anthropic/claude-sonnet-4.5',
  'openai/gpt-4.1',
  'openai/o3',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'x-ai/grok-4',
  'deepseek/deepseek-r1',
  'meta-llama/llama-4-maverick',
  'openrouter/auto',
] as const

export const openrouterProvider: ProviderDefinition = {
  id: 'openrouter',
  displayName: 'OpenRouter',
  requiresApiKey: true,
  apiKeyManagementUrl: 'https://openrouter.ai/settings/keys',
  supportsBaseUrl: false,
  supportsSubscription: true,
  supportsDynamicModelFetch: false,
  models: OPENROUTER_UI_MODELS,
  testModel: 'openrouter/auto',
  supportsAttachment: () => false,
  createAdapter(model, apiKey) {
    if (!includes(OPENROUTER_UI_MODELS, model))
      throw new Error(`Unknown OpenRouter model: ${model}`)
    if (!apiKey) throw new Error('OpenRouter API key is required')
    return createOpenRouterText(model, apiKey)
  },
}
