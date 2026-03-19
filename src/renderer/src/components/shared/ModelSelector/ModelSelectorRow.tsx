import type { Provider } from '@shared/types/settings'
import { Check } from 'lucide-react'
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
import { cn } from '@/lib/cn'
import type { FlatModel } from './types'

type ProviderIcon = (props: {
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

function resolveIcon(provider: Provider, authMethod?: 'api-key' | 'subscription'): ProviderIcon {
  if (authMethod === 'subscription') {
    return SUBSCRIPTION_ICON[provider] ?? API_KEY_ICON[provider] ?? OpenAIIcon
  }
  return API_KEY_ICON[provider] ?? OpenAIIcon
}

function resolveIconColor(provider: Provider, authMethod?: 'api-key' | 'subscription'): string {
  if (authMethod === 'subscription') {
    return SUBSCRIPTION_COLOR[provider] ?? API_KEY_COLOR[provider] ?? 'currentColor'
  }
  return API_KEY_COLOR[provider] ?? 'currentColor'
}

interface ModelSelectorRowProps {
  readonly model: FlatModel
  readonly isSelected: boolean
  readonly onSelect: (model: FlatModel) => void
}

export function ModelSelectorRow({ model, isSelected, onSelect }: ModelSelectorRowProps) {
  const Icon = resolveIcon(model.provider, model.authMethod)
  const iconColor = resolveIconColor(model.provider, model.authMethod)

  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={isSelected}
      aria-label={model.name}
      onClick={() => onSelect(model)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(model)
        }
      }}
      title={model.id}
      className={cn(
        'group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        'cursor-pointer text-[#e7e9ee] hover:bg-[#171b21]',
        isSelected && 'bg-[#1a1f28]',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 flex-none" style={{ color: iconColor }} />
      <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{model.name}</div>
      {isSelected && <Check className="h-3 w-3 shrink-0 text-accent" />}
    </div>
  )
}
