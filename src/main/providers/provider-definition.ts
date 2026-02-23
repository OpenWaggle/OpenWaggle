import type { Provider, QualityPreset } from '@shared/types/settings'
import type { AnyTextAdapter } from '@tanstack/ai'

export interface BaseSamplingConfig {
  readonly temperature: number
  readonly topP: number
  readonly maxTokens: number
}

export interface ResolvedSamplingConfig {
  readonly temperature?: number
  readonly topP?: number
  readonly maxTokens: number
  readonly modelOptions?: Record<string, unknown>
}

export interface ProviderDefinition {
  readonly id: Provider
  readonly displayName: string
  readonly requiresApiKey: boolean
  /** Optional URL where users can create/manage API keys for this provider */
  readonly apiKeyManagementUrl?: string
  readonly supportsBaseUrl: boolean
  readonly models: readonly string[]
  /** Model used for API key testing — should be the cheapest/fastest available */
  readonly testModel: string
  createAdapter(model: string, apiKey: string, baseUrl?: string): AnyTextAdapter
  fetchModels?(baseUrl?: string, apiKey?: string): Promise<string[]>
  resolveSampling?(
    model: string,
    preset: QualityPreset,
    base: BaseSamplingConfig,
  ): ResolvedSamplingConfig
}

export function defaultResolveSampling(
  _m: string,
  _p: QualityPreset,
  base: BaseSamplingConfig,
): ResolvedSamplingConfig {
  return { temperature: base.temperature, topP: base.topP, maxTokens: base.maxTokens }
}
