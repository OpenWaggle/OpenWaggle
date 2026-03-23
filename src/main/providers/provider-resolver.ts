import { isSubscriptionProvider } from '@shared/types/auth'
import type { SupportedModelId } from '@shared/types/llm'
import type { Provider, ProviderConfig, QualityPreset } from '@shared/types/settings'
import { type ResolvedQualityConfig, resolveQualityConfig } from '../agent/quality-config'
import { getActiveApiKey } from '../auth'
import type { ProjectQualityOverrides } from '../config/project-config'
import type { ProviderDefinition } from './provider-definition'
import { providerRegistry } from './registry'

// ---------------------------------------------------------------------------
// buildSamplingOptions — extract the topP conditional
// ---------------------------------------------------------------------------

export function buildSamplingOptions(qualityConfig: { temperature?: number; topP?: number }): {
  temperature?: number
  topP?: number
} {
  const opts: { temperature?: number; topP?: number } = {}
  if (qualityConfig.temperature !== undefined) opts.temperature = qualityConfig.temperature
  if (qualityConfig.topP !== undefined) opts.topP = qualityConfig.topP
  return opts
}

// ---------------------------------------------------------------------------
// resolveProviderAndQuality — centralized provider resolution + validation
// ---------------------------------------------------------------------------

export interface ResolvedProviderResult {
  readonly ok: true
  readonly provider: ProviderDefinition
  readonly providerConfig: ProviderConfig
  readonly resolvedModel: SupportedModelId
  readonly qualityConfig: ResolvedQualityConfig
}

export interface ProviderResolutionError {
  readonly ok: false
  readonly reason: string
}

export type ProviderResolution = ResolvedProviderResult | ProviderResolutionError

export function isResolutionError(result: ProviderResolution): result is ProviderResolutionError {
  return !result.ok
}

export async function resolveProviderAndQuality(
  model: SupportedModelId,
  qualityPreset: QualityPreset,
  providers: Readonly<Partial<Record<Provider, ProviderConfig>>>,
  projectOverrides?: ProjectQualityOverrides,
): Promise<ProviderResolution> {
  const provider = providerRegistry.getProviderForModel(model)
  if (!provider) {
    return { ok: false, reason: `No provider registered for model: ${model}` }
  }

  const providerConfig = providers[provider.id]
  if (!providerConfig?.enabled) {
    return { ok: false, reason: `${provider.displayName} is disabled in settings` }
  }

  // For subscription auth, refresh the token before proceeding
  let effectiveConfig = providerConfig
  if (providerConfig.authMethod === 'subscription' && isSubscriptionProvider(provider.id)) {
    const freshToken = await getActiveApiKey(provider.id)
    if (!freshToken) {
      return {
        ok: false,
        reason: `Session expired for ${provider.displayName}. Please sign in again.`,
      }
    }
    effectiveConfig = { ...providerConfig, apiKey: freshToken }
  }

  if (provider.requiresApiKey && !effectiveConfig.apiKey) {
    return { ok: false, reason: `No API key configured for ${provider.displayName}` }
  }

  const qualityConfig = resolveQualityConfig(provider, model, qualityPreset, projectOverrides)

  return {
    ok: true,
    provider,
    providerConfig: effectiveConfig,
    resolvedModel: model,
    qualityConfig,
  }
}
