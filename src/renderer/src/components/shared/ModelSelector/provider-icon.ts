import type { Provider } from '@shared/types/settings'
import {
  AnthropicIcon,
  ClaudeCodeIcon,
  CodexIcon,
  GeminiIcon,
  GrokIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
} from '@/components/icons/provider-icons'

export type ProviderIcon = (props: {
  className?: string
  style?: React.CSSProperties
}) => React.JSX.Element

const API_KEY_ICON: Record<Provider, ProviderIcon> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  gemini: GeminiIcon,
  grok: GrokIcon,
  openrouter: OpenRouterIcon,
  ollama: OllamaIcon,
}

const SUBSCRIPTION_ICON: Partial<Record<Provider, ProviderIcon>> = {
  openai: CodexIcon,
  anthropic: ClaudeCodeIcon,
}

const API_KEY_COLOR: Record<Provider, string> = {
  anthropic: '#d4a27f',
  openai: '#10a37f',
  gemini: '#3186FF',
  grok: 'currentColor',
  openrouter: '#7c5cfc',
  ollama: 'currentColor',
}

const SUBSCRIPTION_COLOR: Partial<Record<Provider, string>> = {
  openai: '#7A9DFF',
  anthropic: '#D97757',
}

export function resolveIcon(
  provider: Provider,
  authMethod?: 'api-key' | 'subscription',
): ProviderIcon {
  if (authMethod === 'subscription') {
    return SUBSCRIPTION_ICON[provider] ?? API_KEY_ICON[provider] ?? OpenAIIcon
  }
  return API_KEY_ICON[provider] ?? OpenAIIcon
}

export function resolveIconColor(
  provider: Provider,
  authMethod?: 'api-key' | 'subscription',
): string {
  if (authMethod === 'subscription') {
    return SUBSCRIPTION_COLOR[provider] ?? API_KEY_COLOR[provider] ?? 'currentColor'
  }
  return API_KEY_COLOR[provider] ?? 'currentColor'
}
