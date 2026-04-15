/**
 * Resolve provider credentials for a model from settings.
 * Lighter alternative to resolveProviderAndQuality — only resolves
 * the provider, API key, base URL, and auth method without quality config.
 *
 * Used by the context compact handler and any non-run context that
 * needs to create a chat adapter for a given model.
 */
import { isSubscriptionProvider } from '@shared/types/auth'
import type { SupportedModelId } from '@shared/types/llm'
import type { Provider, Settings } from '@shared/types/settings'
import { getActiveApiKey } from '../auth'
import type { ProviderDefinition } from './provider-definition'
import { providerRegistry } from './registry'

export interface ResolvedModelCredentials {
  readonly provider: ProviderDefinition
  readonly apiKey: string | undefined
  readonly baseUrl: string | undefined
  readonly authMethod: 'api-key' | 'subscription' | undefined
}

/**
 * Resolve provider + credentials for a model.
 * Returns null if the provider is not found or disabled.
 */
export async function resolveModelCredentials(
  model: SupportedModelId,
  settings: Settings,
): Promise<ResolvedModelCredentials | null> {
  const provider = providerRegistry.getProviderForModel(String(model))
  if (!provider) return null

  const providerConfig = settings.providers[provider.id as Provider]
  if (!providerConfig?.enabled) return null

  let apiKey = providerConfig.apiKey
  const authMethod = providerConfig.authMethod

  // Refresh OAuth token for subscription auth
  if (authMethod === 'subscription' && isSubscriptionProvider(provider.id)) {
    const freshToken = await getActiveApiKey(provider.id)
    if (freshToken) {
      apiKey = freshToken
    }
  }

  return {
    provider,
    apiKey,
    baseUrl: providerConfig.baseUrl,
    authMethod,
  }
}
