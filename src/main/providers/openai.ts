import type { QualityPreset } from '@shared/types/settings'
import { createOpenaiChat, OPENAI_CHAT_MODELS } from '@tanstack/ai-openai'
import { isReasoningModel } from '../agent/quality-config'
import type {
  BaseSamplingConfig,
  ProviderDefinition,
  ResolvedSamplingConfig,
} from './provider-definition'

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
  resolveSampling(
    model: string,
    preset: QualityPreset,
    base: BaseSamplingConfig,
  ): ResolvedSamplingConfig {
    if (isReasoningModel(model)) {
      return {
        temperature: undefined,
        topP: undefined,
        maxTokens: base.maxTokens * 4,
        modelOptions: { reasoning: { effort: preset, summary: 'auto' } },
      }
    }
    return { temperature: base.temperature, topP: base.topP, maxTokens: base.maxTokens }
  },
}
