/**
 * ProviderService port — domain-owned interface for provider resolution.
 */

import type { ProviderAuthInfo } from '@shared/types/llm'
import type { Provider, ThinkingLevel } from '@shared/types/settings'
import { Context, type Effect } from 'effect'
import type { ProviderLookupError } from '../errors'

export interface ProviderModelCapabilities {
  readonly id: string
  readonly modelId: string
  readonly name?: string
  readonly available: boolean
  readonly reasoning: boolean
  readonly availableThinkingLevels: readonly ThinkingLevel[]
  readonly input: readonly ('text' | 'image')[]
  readonly contextWindow: number
  readonly maxTokens: number
}

export interface ProviderCapabilities {
  readonly id: Provider
  readonly displayName: string
  readonly auth: ProviderAuthInfo
  readonly models: readonly ProviderModelCapabilities[]
  readonly testModel: string
  readonly apiKeyManagementUrl?: string
}

export interface ProviderServiceShape {
  readonly get: (
    providerId: string,
    projectPath?: string | null,
  ) => Effect.Effect<ProviderCapabilities | undefined>
  readonly getAll: (projectPath?: string | null) => Effect.Effect<readonly ProviderCapabilities[]>
  readonly getProviderForModel: (
    modelId: string,
    projectPath?: string | null,
  ) => Effect.Effect<ProviderCapabilities, ProviderLookupError>
  readonly isKnownModel: (modelId: string, projectPath?: string | null) => Effect.Effect<boolean>
}

export class ProviderService extends Context.Tag('@openwaggle/ProviderService')<
  ProviderService,
  ProviderServiceShape
>() {}
