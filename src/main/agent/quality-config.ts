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
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o[1-4])/.test(model)
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
    maxTokens: tier.maxTokens,
    modelOptions: tier.modelOptions,
  }
}
