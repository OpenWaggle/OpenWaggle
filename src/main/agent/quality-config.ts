import type { SupportedModelId } from '@shared/types/llm'
import type { Provider, QualityPreset } from '@shared/types/settings'

interface QualityTierConfig {
  readonly model?: SupportedModelId
  readonly temperature: number
  readonly topP?: number
  readonly maxTokens: number
  readonly modelOptions?: Record<string, unknown>
}

export interface ResolvedQualityConfig {
  readonly model: SupportedModelId
  readonly temperature?: number
  readonly topP?: number
  readonly maxTokens: number
  readonly modelOptions?: Record<string, unknown>
}

const QUALITY_MODEL_MAP: Record<Provider, Record<QualityPreset, SupportedModelId | undefined>> = {
  anthropic: {
    low: 'claude-haiku-4-5',
    medium: 'claude-sonnet-4-5',
    high: 'claude-opus-4-6',
  },
  openai: {
    low: 'gpt-5-mini',
    medium: 'gpt-5',
    high: 'gpt-5.2',
  },
  gemini: {
    low: 'gemini-2.5-flash-lite',
    medium: 'gemini-2.5-flash',
    high: 'gemini-2.5-pro',
  },
  grok: {
    low: 'grok-3-mini',
    medium: 'grok-4-fast-non-reasoning',
    high: 'grok-4',
  },
  openrouter: {
    low: 'openrouter/auto',
    medium: 'openai/gpt-4.1',
    high: 'anthropic/claude-opus-4',
  },
  ollama: {
    low: undefined,
    medium: undefined,
    high: undefined,
  },
}

const QUALITY_TIER_CONFIG: Record<QualityPreset, QualityTierConfig> = {
  low: {
    temperature: 0.25,
    topP: 0.9,
    maxTokens: 1200,
  },
  medium: {
    temperature: 0.4,
    topP: 0.95,
    maxTokens: 2200,
  },
  high: {
    temperature: 0.55,
    topP: 1,
    maxTokens: 4200,
  },
}

/**
 * Reasoning models (GPT-5 family, o-series) reject temperature/topP parameters.
 */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[1-4])/.test(model)
}

/**
 * Build provider-specific model options for reasoning/thinking support.
 * OpenAI reasoning models use `reasoning` options; Anthropic uses `thinking`.
 */
function buildModelOptions(
  provider: Provider,
  model: string,
  preset: QualityPreset,
): Record<string, unknown> | undefined {
  if (provider === 'openai' && isReasoningModel(model)) {
    return {
      reasoning: { effort: preset === 'low' ? 'low' : 'medium', summary: 'auto' },
    }
  }
  if (provider === 'anthropic') {
    if (model.includes('opus')) {
      return {
        thinking: { type: 'adaptive' },
        effort: preset === 'low' ? 'low' : 'medium',
      }
    }
    return {
      thinking: { type: 'enabled', budget_tokens: preset === 'low' ? 1024 : 4096 },
    }
  }
  return undefined
}

/**
 * Adjust maxTokens for reasoning/thinking models.
 * OpenAI: max_output_tokens includes reasoning + visible output → multiply.
 * Anthropic: max_tokens must exceed thinking budget_tokens → floor at 8192.
 */
function resolveMaxTokens(provider: Provider, model: string, baseMaxTokens: number): number {
  if (provider === 'openai' && isReasoningModel(model)) {
    return baseMaxTokens * 4
  }
  if (provider === 'anthropic') {
    return Math.max(baseMaxTokens, 8192)
  }
  return baseMaxTokens
}

export function resolveQualityConfig(
  provider: Provider,
  selectedModel: SupportedModelId,
  preset: QualityPreset,
): ResolvedQualityConfig {
  const tier = QUALITY_TIER_CONFIG[preset]
  const mappedModel = QUALITY_MODEL_MAP[provider][preset]
  const model = mappedModel ?? selectedModel
  const reasoning = isReasoningModel(model)
  const topP = provider === 'anthropic' || reasoning ? undefined : tier.topP

  return {
    model,
    temperature: reasoning ? undefined : tier.temperature,
    topP,
    maxTokens: resolveMaxTokens(provider, model, tier.maxTokens),
    modelOptions: buildModelOptions(provider, model, preset),
  }
}
