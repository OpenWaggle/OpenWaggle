import type { CredentialInfo } from '@earendil-works/pi-ai'
import type { AgentSessionServices, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ThinkingLevel } from '@shared/types/settings'

export interface ProviderModelRecord {
  readonly ref: string
  readonly provider: string
  readonly id: string
  readonly name: string
  readonly available: boolean
  readonly reasoning: boolean
  readonly availableThinkingLevels: readonly ThinkingLevel[]
  readonly input: readonly ('text' | 'image')[]
  readonly contextWindow: number
  readonly maxTokens: number
  readonly api: string
}

export interface ProviderCatalogRecord {
  readonly provider: string
  readonly models: readonly ProviderModelRecord[]
}

export interface PiExtensionLoadErrorRecord {
  readonly path: string
  readonly error: string
}

export interface ProviderCatalogSnapshot {
  readonly providers: readonly ProviderCatalogRecord[]
  readonly providerNames: ReadonlyMap<string, string>
  readonly apiKeyProviders: ReadonlySet<string>
  readonly oauthProviders: ReadonlySet<string>
  readonly credentials: ReadonlyMap<string, CredentialInfo>
  readonly configuredAuthProviders: ReadonlySet<string>
  readonly extensionLoadErrors: readonly PiExtensionLoadErrorRecord[]
}

export type PiModel = NonNullable<ReturnType<ModelRuntime['getModel']>>

export interface PiModelRuntime {
  readonly model: PiModel
}

export interface PiProjectModelRuntime extends PiModelRuntime {
  readonly services: AgentSessionServices
}
