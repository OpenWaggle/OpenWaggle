import type { Provider } from '@shared/types/settings'
import {
  AnthropicIcon,
  GeminiIcon,
  GroqIcon,
  getProviderIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
} from '@/features/providers/components'

type ProviderIcon = typeof OpenAIIcon

export interface ProviderMeta {
  readonly icon: ProviderIcon
  readonly iconClassName: string
}

export const PROVIDER_META: Partial<Record<Provider, ProviderMeta>> = {
  openai: {
    icon: OpenAIIcon,
    iconClassName: 'text-success',
  },
  anthropic: {
    icon: AnthropicIcon,
    iconClassName: 'text-accent-dim',
  },
  google: {
    icon: GeminiIcon,
    iconClassName: 'text-info-text',
  },
  'google-gemini-cli': {
    icon: GeminiIcon,
    iconClassName: 'text-info-text',
  },
  'google-antigravity': {
    icon: GeminiIcon,
    iconClassName: 'text-info-text',
  },
  xai: {
    icon: getProviderIcon('xai'),
    iconClassName: 'text-warning',
  },
  groq: {
    icon: GroqIcon,
    iconClassName: 'text-warning',
  },
  deepseek: {
    icon: getProviderIcon('deepseek'),
    iconClassName: 'text-info',
  },
  openrouter: {
    icon: OpenRouterIcon,
    iconClassName: 'text-review',
  },
  ollama: {
    icon: OllamaIcon,
    iconClassName: 'text-neutral',
  },
}

export function getProviderMeta(provider: Provider): ProviderMeta {
  return (
    PROVIDER_META[provider] ?? {
      icon: getProviderIcon(provider),
      iconClassName: 'text-text-tertiary',
    }
  )
}
