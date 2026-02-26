import type { JsonObject } from '@shared/types/json'
import type { SupportedModelId } from '@shared/types/llm'
import type { QualityPreset } from '@shared/types/settings'
import type { ProjectQualityOverrides } from '../config/project-config'
import {
  type BaseSamplingConfig,
  defaultResolveSampling,
  type ProviderDefinition,
} from '../providers/provider-definition'

export interface ResolvedQualityConfig {
  readonly model: SupportedModelId
  readonly temperature?: number
  readonly topP?: number
  readonly maxTokens: number
  readonly modelOptions?: Readonly<JsonObject>
}

const QUALITY_TIER_CONFIG: Record<QualityPreset, BaseSamplingConfig> = {
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

export function resolveQualityConfig(
  provider: ProviderDefinition,
  selectedModel: SupportedModelId,
  preset: QualityPreset,
  projectOverrides?: ProjectQualityOverrides,
): ResolvedQualityConfig {
  const appDefaults = QUALITY_TIER_CONFIG[preset]
  const projectTier = projectOverrides?.[preset]

  const base: BaseSamplingConfig = {
    temperature: projectTier?.temperature ?? appDefaults.temperature,
    topP: projectTier?.topP ?? appDefaults.topP,
    maxTokens: projectTier?.maxTokens ?? appDefaults.maxTokens,
  }

  const resolve = provider.resolveSampling ?? defaultResolveSampling
  const sampling = resolve(selectedModel, preset, base)

  return { model: selectedModel, ...sampling }
}
