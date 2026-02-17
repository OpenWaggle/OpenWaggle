import type { AnyTextAdapter } from '@tanstack/ai'

export interface ProviderDefinition {
  readonly id: string
  readonly displayName: string
  readonly requiresApiKey: boolean
  readonly supportsBaseUrl: boolean
  readonly models: readonly string[]
  createAdapter(model: string, apiKey: string, baseUrl?: string): AnyTextAdapter
  fetchModels?(baseUrl?: string, apiKey?: string): Promise<string[]>
}
