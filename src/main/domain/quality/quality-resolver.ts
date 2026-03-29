import type { JsonObject } from '@shared/types/json'
import type { SupportedModelId } from '@shared/types/llm'
import type { QualityPreset } from '@shared/types/settings'
import type { ProjectQualityOverrides } from '../../config/project-config'
import {
  type BaseSamplingConfig,
  defaultResolveSampling,
  type ProviderDefinition,
} from '../../providers/provider-definition'

const TEMPERATURE = 0.25
const TOP_P = 0.9
const MAX_TOKENS = 1200
const TEMPERATURE_VALUE_0_4 = 0.4
const TOP_P_VALUE_0_95 = 0.95
const MAX_TOKENS_VALUE_2200 = 2200
const TEMPERATURE_VALUE_0_55 = 0.55
const MAX_TOKENS_VALUE_4200 = 4200

export interface ResolvedQualityConfig {
  readonly model: SupportedModelId
  readonly temperature?: number
  readonly topP?: number
  readonly maxTokens: number
  readonly modelOptions?: Readonly<JsonObject>
}

const QUALITY_TIER_CONFIG: Record<QualityPreset, BaseSamplingConfig> = {
  low: {
    temperature: TEMPERATURE,
    topP: TOP_P,
    maxTokens: MAX_TOKENS,
  },
  medium: {
    temperature: TEMPERATURE_VALUE_0_4,
    topP: TOP_P_VALUE_0_95,
    maxTokens: MAX_TOKENS_VALUE_2200,
  },
  high: {
    temperature: TEMPERATURE_VALUE_0_55,
    topP: 1,
    maxTokens: MAX_TOKENS_VALUE_4200,
  },
}

// Re-export from canonical location in providers layer
export { isReasoningModel } from '../../providers/model-classification'

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
