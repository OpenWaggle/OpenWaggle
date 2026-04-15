import { includes } from '@shared/utils/validation'
import { createGeminiChat, GeminiTextModels } from '@tanstack/ai-gemini'
import type { ModelContextWindow } from '../domain/compaction/compaction-types'
import type { ProviderDefinition } from './provider-definition'

const GEMINI_CONTEXT_1M = 1_000_000
const GEMINI_CONTEXT_2M = 2_000_000
const GEMINI_MAX_OUTPUT_65K = 65_536

function getGeminiContextWindow(model: string): ModelContextWindow | undefined {
  if (model.includes('2.5-pro')) {
    return { contextTokens: GEMINI_CONTEXT_1M, maxOutputTokens: GEMINI_MAX_OUTPUT_65K }
  }
  if (model.includes('2.5-flash')) {
    return { contextTokens: GEMINI_CONTEXT_1M, maxOutputTokens: GEMINI_MAX_OUTPUT_65K }
  }
  if (model.includes('2.0-flash')) {
    return { contextTokens: GEMINI_CONTEXT_1M, maxOutputTokens: GEMINI_MAX_OUTPUT_65K }
  }
  // Gemini 1.5 models have 2M context
  if (model.includes('1.5')) {
    return { contextTokens: GEMINI_CONTEXT_2M, maxOutputTokens: GEMINI_MAX_OUTPUT_65K }
  }
  return { contextTokens: GEMINI_CONTEXT_1M, maxOutputTokens: GEMINI_MAX_OUTPUT_65K }
}

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
  getContextWindow: getGeminiContextWindow,
}
