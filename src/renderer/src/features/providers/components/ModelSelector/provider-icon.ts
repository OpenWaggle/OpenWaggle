import type { Provider } from '@shared/types/settings'
import { createElement, type ReactElement } from 'react'
import { getProviderIcon } from '@/features/providers/components/provider-icons'

interface ProviderModelIconProps {
  readonly provider: Provider
  readonly className?: string
}

export function ProviderModelIcon({ provider, className }: ProviderModelIconProps): ReactElement {
  return createElement(getProviderIcon(provider), { className })
}
