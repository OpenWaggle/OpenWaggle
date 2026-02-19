import type { Provider } from '@shared/types/settings'
import type { AnyTextAdapter } from '@tanstack/ai'

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
}
