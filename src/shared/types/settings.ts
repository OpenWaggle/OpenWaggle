import type { SupportedModelId } from './llm'

export const PROVIDERS = ['anthropic', 'openai'] as const
export type Provider = (typeof PROVIDERS)[number]

export interface ProviderConfig {
  readonly apiKey: string
}

export interface Settings {
  readonly providers: Readonly<Record<Provider, ProviderConfig>>
  readonly defaultModel: SupportedModelId
  readonly projectPath: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  providers: {
    anthropic: { apiKey: '' },
    openai: { apiKey: '' },
  },
  defaultModel: 'claude-sonnet-4-5',
  projectPath: null,
}

/** Type guard for Provider — uses widened array check to avoid cast */
export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value)
}
