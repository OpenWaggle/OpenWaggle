export const PROVIDERS = ['anthropic', 'openai', 'gemini', 'grok', 'openrouter', 'ollama'] as const
export type Provider = (typeof PROVIDERS)[number]

export interface ProviderConfig {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly enabled: boolean
}

export interface Settings {
  readonly providers: Readonly<Partial<Record<Provider, ProviderConfig>>>
  readonly defaultModel: string
  readonly projectPath: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  providers: {
    anthropic: { apiKey: '', enabled: true },
    openai: { apiKey: '', enabled: true },
    gemini: { apiKey: '', enabled: false },
    grok: { apiKey: '', enabled: false },
    openrouter: { apiKey: '', enabled: false },
    ollama: { apiKey: '', baseUrl: 'http://localhost:11434', enabled: false },
  },
  defaultModel: 'claude-sonnet-4-5',
  projectPath: null,
}

/** Type guard for Provider — uses widened array check to avoid cast */
export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value)
}
