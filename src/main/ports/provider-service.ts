/**
 * ProviderService port — domain-owned interface for provider resolution.
 *
 * Extends the existing ProviderRegistryService with adapter creation
 * that returns domain-owned ChatAdapter instead of vendor AnyTextAdapter.
 */
import type { Provider } from '@shared/types/settings'
import { Context, type Effect } from 'effect'
import type { ProviderLookupError } from '../errors'
import type { ChatAdapter } from './chat-adapter-type'

export interface ProviderCapabilities {
  readonly id: Provider
  readonly displayName: string
  readonly requiresApiKey: boolean
  readonly supportsBaseUrl: boolean
  readonly supportsSubscription: boolean
  readonly supportsDynamicModelFetch: boolean
  readonly models: readonly string[]
  readonly testModel: string
  readonly apiKeyManagementUrl?: string
}

export interface ProviderServiceShape {
  readonly get: (providerId: string) => Effect.Effect<ProviderCapabilities | undefined>
  readonly getAll: () => Effect.Effect<readonly ProviderCapabilities[]>
  readonly getProviderForModel: (
    modelId: string,
  ) => Effect.Effect<ProviderCapabilities, ProviderLookupError>
  readonly isKnownModel: (modelId: string) => Effect.Effect<boolean>
  readonly createChatAdapter: (
    model: string,
    apiKey: string | undefined,
    baseUrl?: string,
    authMethod?: 'api-key' | 'subscription',
  ) => Effect.Effect<ChatAdapter, ProviderLookupError>
  readonly indexModels: (
    modelIds: readonly string[],
    providerId: string,
  ) => Effect.Effect<void, ProviderLookupError>
  readonly fetchModels: (
    providerId: string,
    baseUrl?: string,
    apiKey?: string,
    authMethod?: 'api-key' | 'subscription',
  ) => Effect.Effect<readonly string[]>
}

export class ProviderService extends Context.Tag('@openwaggle/ProviderService')<
  ProviderService,
  ProviderServiceShape
>() {}
