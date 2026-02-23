import type { QualityPreset } from '@shared/types/settings'
import { ANTHROPIC_MODELS, createAnthropicChat } from '@tanstack/ai-anthropic'
import type {
  BaseSamplingConfig,
  ProviderDefinition,
  ResolvedSamplingConfig,
} from './provider-definition'

/**
 * Thinking token budgets per quality tier.
 * Opus gets larger budgets to leverage its deeper reasoning capabilities.
 *
 * Note: TanStack's Anthropic adapter has a bug where `effort` (adaptive thinking)
 * is included in validKeys but spread raw into the API request, causing a 400.
 * We use budget_tokens for all models until this is fixed upstream.
 */
const THINKING_BUDGET: Record<QualityPreset, number> = { low: 1024, medium: 4096, high: 10240 }
const OPUS_THINKING_BUDGET: Record<QualityPreset, number> = { low: 2048, medium: 8192, high: 16384 }

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
  resolveSampling(
    model: string,
    preset: QualityPreset,
    base: BaseSamplingConfig,
  ): ResolvedSamplingConfig {
    const budget = model.includes('opus') ? OPUS_THINKING_BUDGET[preset] : THINKING_BUDGET[preset]
    return {
      temperature: undefined,
      topP: undefined,
      maxTokens: Math.max(base.maxTokens, 8192),
      modelOptions: { thinking: { type: 'enabled', budget_tokens: budget } },
    }
  },
}
