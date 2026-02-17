import { ANTHROPIC_MODELS } from '@tanstack/ai-anthropic'
import { OPENAI_CHAT_MODELS } from '@tanstack/ai-openai'
import type { Provider } from './settings'

// All supported model IDs — derived from TanStack AI's const tuples
export const SUPPORTED_MODELS = [...ANTHROPIC_MODELS, ...OPENAI_CHAT_MODELS] as const
export type SupportedModelId = (typeof SUPPORTED_MODELS)[number]

// The subset we surface in the UI (curated list)
export const UI_MODELS = [
  // Anthropic
  'claude-opus-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
  'claude-sonnet-4',
  // OpenAI
  'gpt-4.1',
  'gpt-4.1-mini',
  'o3',
  'o4-mini',
] as const satisfies readonly SupportedModelId[]

export type UIModelId = (typeof UI_MODELS)[number]

export function getProvider(model: SupportedModelId): Provider {
  return (ANTHROPIC_MODELS as readonly string[]).includes(model) ? 'anthropic' : 'openai'
}

// Display info for UI
export interface ModelDisplayInfo {
  readonly id: UIModelId
  readonly name: string
  readonly provider: Provider
}

export const MODEL_DISPLAY_INFO: readonly ModelDisplayInfo[] = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', provider: 'anthropic' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic' },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai' },
  { id: 'o3', name: 'o3', provider: 'openai' },
  { id: 'o4-mini', name: 'o4-mini', provider: 'openai' },
]
