import { isRecord } from '@shared/utils/validation'
import { createOpenRouterText } from '@tanstack/ai-openrouter'
import { createLogger } from '../logger'
import type { ProviderDefinition } from './provider-definition'

const logger = createLogger('openrouter-provider')
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1'

/**
 * Fallback curated list used when dynamic fetch fails.
 * OpenRouter has a public /v1/models endpoint so this should rarely be needed.
 */
const OPENROUTER_FALLBACK_MODELS = [
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
  supportsDynamicModelFetch: true,
  models: OPENROUTER_FALLBACK_MODELS,
  testModel: 'openrouter/auto',
  supportsAttachment: () => false,
  createAdapter(model, apiKey) {
    if (!apiKey) throw new Error('OpenRouter API key is required')
    return createOpenRouterText(model, apiKey)
  },
  async fetchModels(_baseUrl, apiKey) {
    if (!apiKey) return [...OPENROUTER_FALLBACK_MODELS]
    try {
      const response = await fetch(`${OPENROUTER_API_BASE}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      if (!response.ok) return [...OPENROUTER_FALLBACK_MODELS]
      const body: unknown = await response.json()
      if (!isRecord(body) || !Array.isArray(body.data)) return [...OPENROUTER_FALLBACK_MODELS]
      const models: string[] = []
      for (const entry of body.data) {
        if (!isRecord(entry) || typeof entry.id !== 'string') continue
        // Filter to text generation models only (exclude image/audio/moderation)
        const arch = isRecord(entry.architecture) ? entry.architecture : {}
        const modality =
          typeof arch.output_modalities === 'object' && Array.isArray(arch.output_modalities)
            ? arch.output_modalities
            : []
        if (modality.length > 0 && !modality.includes('text')) continue
        models.push(entry.id)
      }
      return models.length > 0 ? models : [...OPENROUTER_FALLBACK_MODELS]
    } catch (err) {
      logger.warn('Failed to fetch OpenRouter models dynamically', {
        error: err instanceof Error ? err.message : 'unknown',
      })
      return [...OPENROUTER_FALLBACK_MODELS]
    }
  },
}
