import type { Provider } from '@shared/types/settings'
import { type CSSProperties, createElement, type ReactElement } from 'react'
import { getProviderIcon } from '@/components/icons/provider-icons'

interface ProviderModelIconProps {
  readonly provider: Provider
  readonly className?: string
  readonly style?: CSSProperties
}

export function ProviderModelIcon({
  provider,
  className,
  style,
}: ProviderModelIconProps): ReactElement {
  return createElement(getProviderIcon(provider), { className, style })
}

const PROVIDER_COLOR: Partial<Record<Provider, string>> = {
  anthropic: '#d4a27f',
  openai: '#10a37f',
  'openai-codex': '#7A9DFF',
  'github-copilot': '#7A9DFF',
  google: '#3186FF',
  'google-gemini-cli': '#3186FF',
  'google-antigravity': '#3186FF',
  'google-vertex': '#3186FF',
  deepseek: '#4d6bfe',
  xai: 'currentColor',
  openrouter: '#7c5cfc',
  ollama: 'currentColor',
}

export function resolveIconColor(provider: Provider): string {
  return PROVIDER_COLOR[provider] ?? 'currentColor'
}
