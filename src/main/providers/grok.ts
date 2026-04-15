import { includes } from '@shared/utils/validation'
import { createGrokText, GROK_CHAT_MODELS } from '@tanstack/ai-grok'
import type { ModelContextWindow } from '../domain/compaction/compaction-types'
import type { ProviderDefinition } from './provider-definition'

const GROK_CONTEXT_131K = 131_072
const GROK_MAX_OUTPUT_131K = 131_072

function getGrokContextWindow(model: string): ModelContextWindow | undefined {
  // All current Grok models use 131K context
  if (model.startsWith('grok-')) {
    return { contextTokens: GROK_CONTEXT_131K, maxOutputTokens: GROK_MAX_OUTPUT_131K }
  }
  return undefined
}

export const grokProvider: ProviderDefinition = {
  id: 'grok',
  displayName: 'Grok',
  requiresApiKey: true,
  apiKeyManagementUrl: 'https://console.x.ai/team/default/api-keys',
  supportsBaseUrl: false,
  supportsSubscription: false,
  supportsDynamicModelFetch: false,
  models: GROK_CHAT_MODELS,
  testModel: 'grok-3-mini-fast',
  supportsAttachment: () => false,
  createAdapter(model, apiKey) {
    if (!includes(GROK_CHAT_MODELS, model)) throw new Error(`Unknown Grok model: ${model}`)
    if (!apiKey) throw new Error('Grok API key is required')
    return createGrokText(model, apiKey)
  },
  getContextWindow: getGrokContextWindow,
}
