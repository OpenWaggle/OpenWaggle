import type {
  AgentSessionServices,
  AuthCredential,
  AuthStorage,
  ModelRegistry,
} from '@mariozechner/pi-coding-agent'
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

export interface ProviderCatalogSnapshot {
  readonly providers: readonly ProviderCatalogRecord[]
  readonly oauthProviders: ReadonlySet<string>
  readonly oauthProviderNames: ReadonlyMap<string, string>
  readonly credentials: ReadonlyMap<string, AuthCredential>
  readonly configuredAuthProviders: ReadonlySet<string>
  readonly builtInModelProviders: ReadonlySet<string>
}

export type PiModel = NonNullable<ReturnType<ModelRegistry['find']>>

export interface PiModelRuntime {
  readonly model: PiModel
  readonly authStorage: AuthStorage
  readonly modelRegistry: ModelRegistry
}

export interface PiProjectModelRuntime extends PiModelRuntime {
  readonly services: AgentSessionServices
}
