import type { SubscriptionProvider } from '@shared/types/auth'
import type { Provider } from '@shared/types/settings'
import {
  AnthropicIcon,
  GeminiIcon,
  GrokIcon,
  OllamaIcon,
  OpenAIIcon,
  OpenRouterIcon,
} from '@/components/icons/provider-icons'

type ProviderIcon = typeof OpenAIIcon

export const PROVIDER_META: Record<
  Provider,
  {
    icon: ProviderIcon
    color: string
    description: string
  }
> = {
  openai: {
    icon: OpenAIIcon,
    color: '#10a37f',
    description: 'GPT-4o, o1, o3 and other OpenAI models',
  },
  anthropic: {
    icon: AnthropicIcon,
    color: '#d4a27f',
    description: 'Claude Sonnet, Opus, Haiku models',
  },
  gemini: {
    icon: GeminiIcon,
    color: '#4285f4',
    description: 'Gemini 2.5 Pro, Flash and other Google AI models',
  },
  grok: {
    icon: GrokIcon,
    color: '#e44d26',
    description: 'Grok models from xAI',
  },
  openrouter: {
    icon: OpenRouterIcon,
    color: '#7c5cfc',
    description: 'Access models from multiple providers via OpenRouter',
  },
  ollama: {
    icon: OllamaIcon,
    color: '#555d6e',
    description: 'Run open-source models locally with Ollama',
  },
}

export const SUBSCRIPTION_META: Record<
  SubscriptionProvider,
  {
    icon: ProviderIcon
    iconColor: string
    connectedLogoBg: string
    connectedLogoBorder: string
    disconnectedLogoBg: string
    disconnectedLogoBorder: string
    name: string
    description: string
    tosWarning?: string
  }
> = {
  anthropic: {
    icon: AnthropicIcon,
    iconColor: '#d4a27f',
    connectedLogoBg: '#1a1520',
    connectedLogoBorder: '#2a2040',
    disconnectedLogoBg: '#111418',
    disconnectedLogoBorder: '#1e2229',
    name: 'Anthropic Subscription',
    description: 'Sign in with your Claude Pro/Max subscription',
    tosWarning:
      "Anthropic's Terms of Service prohibit using subscription OAuth tokens in third-party applications. After signing in, copy the authorization code from the browser — it will be picked up from your clipboard automatically.",
  },
  openai: {
    icon: OpenAIIcon,
    iconColor: '#10a37f',
    connectedLogoBg: '#0f1a14',
    connectedLogoBorder: '#1a3025',
    disconnectedLogoBg: '#111418',
    disconnectedLogoBorder: '#1e2229',
    name: 'OpenAI Subscription',
    description: 'Sign in with your ChatGPT Plus/Pro subscription',
    tosWarning:
      "Uses OpenAI's Codex authentication flow. This is not officially supported for third-party applications.",
  },
  openrouter: {
    icon: OpenRouterIcon,
    iconColor: '#7c5cfc',
    connectedLogoBg: '#13111f',
    connectedLogoBorder: '#251f40',
    disconnectedLogoBg: '#111418',
    disconnectedLogoBorder: '#1e2229',
    name: 'OpenRouter Subscription',
    description: 'Sign in with your OpenRouter account',
  },
}

export const SUBSCRIPTION_PROVIDER_ORDER: SubscriptionProvider[] = [
  'openrouter',
  'openai',
  'anthropic',
]
