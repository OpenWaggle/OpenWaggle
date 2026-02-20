export const PROVIDERS = ['anthropic', 'openai', 'gemini', 'grok', 'openrouter', 'ollama'] as const
export type Provider = (typeof PROVIDERS)[number]
export const EXECUTION_MODES = ['sandbox', 'full-access'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]
export const ORCHESTRATION_MODES = ['orchestrated', 'classic', 'auto-fallback'] as const
export type OrchestrationMode = (typeof ORCHESTRATION_MODES)[number]
export const QUALITY_PRESETS = ['low', 'medium', 'high'] as const
export type QualityPreset = (typeof QUALITY_PRESETS)[number]

export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434'

/** Fallback model IDs for migration — single source of truth */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-5'
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini'

export interface ProviderConfig {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly enabled: boolean
}

export interface Settings {
  readonly providers: Readonly<Partial<Record<Provider, ProviderConfig>>>
  readonly defaultModel: string
  readonly projectPath: string | null
  readonly executionMode: ExecutionMode
  readonly orchestrationMode: OrchestrationMode
  readonly qualityPreset: QualityPreset
  readonly recentProjects: readonly string[]
  readonly skillTogglesByProject: Readonly<Record<string, Readonly<Record<string, boolean>>>>
}

export const DEFAULT_SETTINGS: Settings = {
  providers: {
    anthropic: { apiKey: '', enabled: true },
    openai: { apiKey: '', enabled: true },
    gemini: { apiKey: '', enabled: false },
    grok: { apiKey: '', enabled: false },
    openrouter: { apiKey: '', enabled: false },
    ollama: { apiKey: '', baseUrl: OLLAMA_DEFAULT_BASE_URL, enabled: false },
  },
  defaultModel: DEFAULT_ANTHROPIC_MODEL,
  projectPath: null,
  executionMode: 'sandbox',
  orchestrationMode: 'auto-fallback',
  qualityPreset: 'medium',
  recentProjects: [],
  skillTogglesByProject: {},
}

/** Type guard for Provider — uses widened array check to avoid cast */
export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value)
}
