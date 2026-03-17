import type { QualityPreset } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import {
  ANTHROPIC_MODELS,
  AnthropicTextAdapter,
  type AnthropicTextConfig,
  createAnthropicChat,
} from '@tanstack/ai-anthropic'
import type {
  BaseSamplingConfig,
  ProviderDefinition,
  ResolvedSamplingConfig,
} from './provider-definition'

const LOW = 1024
const MEDIUM = 4096
const HIGH = 10240
const LOW_VALUE_2048 = 2048
const MEDIUM_VALUE_8192 = 8192
const HIGH_VALUE_16384 = 16384
const MAX_ARG_2 = 8192

/**
 * Thinking token budgets for older Anthropic models (pre-4.5).
 * claude-*-4-5 and claude-*-4-6 use adaptive thinking + effort instead.
 */
const THINKING_BUDGET: Record<QualityPreset, number> = { low: LOW, medium: MEDIUM, high: HIGH }
const OPUS_THINKING_BUDGET: Record<QualityPreset, number> = {
  low: LOW_VALUE_2048,
  medium: MEDIUM_VALUE_8192,
  high: HIGH_VALUE_16384,
}

/**
 * Claude 4.5+ models use adaptive thinking with the effort parameter.
 * budget_tokens is deprecated on these models.
 * @see https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-6
 */
function isAdaptiveThinkingModel(model: string): boolean {
  return /4[-.]5|4[-.]6/.test(model)
}

const EFFORT_MAP: Record<QualityPreset, 'low' | 'medium' | 'high' | 'max'> = {
  low: 'low',
  medium: 'medium',
  high: 'max',
}

export const anthropicProvider: ProviderDefinition = {
  id: 'anthropic',
  displayName: 'Anthropic',
  requiresApiKey: true,
  apiKeyManagementUrl: 'https://platform.claude.com/settings/keys',
  supportsBaseUrl: false,
  supportsSubscription: true,
  supportsDynamicModelFetch: false,
  models: ANTHROPIC_MODELS,
  testModel: 'claude-haiku-4-5',
  supportsAttachment: (kind) => kind === 'image' || kind === 'pdf',
  createAdapter(model, apiKey, _baseUrl, authMethod) {
    if (!includes(ANTHROPIC_MODELS, model)) throw new Error(`Unknown Anthropic model: ${model}`)
    if (!apiKey) throw new Error('Anthropic API key is required')
    if (authMethod === 'subscription') {
      const config: AnthropicTextConfig = {
        apiKey: '',
        authToken: apiKey,
        defaultHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
      }
      return new AnthropicTextAdapter(config, model)
    }
    return createAnthropicChat(model, apiKey)
  },
  resolveSampling(
    model: string,
    preset: QualityPreset,
    base: BaseSamplingConfig,
  ): ResolvedSamplingConfig {
    if (isAdaptiveThinkingModel(model)) {
      // claude-*-4-5 and claude-*-4-6: use adaptive thinking + effort (budget_tokens deprecated)
      return {
        temperature: undefined,
        topP: undefined,
        maxTokens: Math.max(base.maxTokens, MAX_ARG_2),
        modelOptions: { thinking: { type: 'adaptive' }, effort: EFFORT_MAP[preset] },
      }
    }
    // Older models: use explicit budget_tokens
    const budget = model.includes('opus') ? OPUS_THINKING_BUDGET[preset] : THINKING_BUDGET[preset]
    return {
      temperature: undefined,
      topP: undefined,
      maxTokens: Math.max(base.maxTokens, MAX_ARG_2),
      modelOptions: { thinking: { type: 'enabled', budget_tokens: budget } },
    }
  },
}
