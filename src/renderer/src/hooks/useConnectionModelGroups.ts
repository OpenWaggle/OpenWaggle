import type { ModelDisplayInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import { useEffect, useState } from 'react'
import type { ModelGroup } from '@/components/settings/sections/connections/ModelGroupAccordion'
import {
  SUBSCRIPTION_META,
  SUBSCRIPTION_PROVIDER_ORDER,
} from '@/components/settings/sections/connections/meta'
import { useAuth, useProviders } from '@/hooks/useSettings'
import { api } from '@/lib/ipc'

/**
 * Fetches API-key and subscription model lists for all active connections,
 * then assembles them into display-ready groups.
 */
export function useConnectionModelGroups(
  providerSettings: Record<
    string,
    { enabled?: boolean; apiKey?: string; baseUrl?: string } | undefined
  >,
): readonly ModelGroup[] {
  const { providerModels } = useProviders()
  const { authAccounts } = useAuth()

  const [apiKeyModels, setApiKeyModels] = useState<
    Partial<Record<Provider, readonly ModelDisplayInfo[]>>
  >({})
  const [subscriptionModels, setSubscriptionModels] = useState<
    Partial<Record<Provider, readonly ModelDisplayInfo[]>>
  >({})

  useEffect(() => {
    let cancelled = false

    for (const providerGroup of providerModels) {
      const config = providerSettings[providerGroup.provider]
      if (!config?.enabled || !config.apiKey?.trim()) continue
      const apiKey = config.apiKey.trim()
      const baseUrl = config.baseUrl?.trim() || undefined
      api
        .fetchProviderModels(providerGroup.provider, baseUrl, apiKey, 'api-key')
        .then((models) => {
          if (cancelled) return
          if (models.length > 0) {
            setApiKeyModels((prev) => ({ ...prev, [providerGroup.provider]: models }))
          } else {
            setApiKeyModels((prev) => ({ ...prev, [providerGroup.provider]: providerGroup.models }))
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return
          const message = err instanceof Error ? err.message : 'unknown'
          console.warn(
            `[useConnectionModelGroups] fetchProviderModels failed for ${providerGroup.provider}`,
            message,
          )
          setApiKeyModels((prev) => ({ ...prev, [providerGroup.provider]: providerGroup.models }))
        })
    }

    return () => {
      cancelled = true
    }
  }, [providerModels, providerSettings])

  useEffect(() => {
    let cancelled = false

    for (const subProvider of SUBSCRIPTION_PROVIDER_ORDER) {
      const account = authAccounts[subProvider]
      if (!account?.connected) continue
      const config = providerSettings[subProvider]
      const apiKey = config?.apiKey?.trim() || undefined
      api
        .fetchProviderModels(subProvider, undefined, apiKey, 'subscription')
        .then((models) => {
          if (cancelled) return
          setSubscriptionModels((prev) => ({ ...prev, [subProvider]: models }))
        })
        .catch((err: unknown) => {
          if (cancelled) return
          const message = err instanceof Error ? err.message : 'unknown'
          console.warn(
            `[useConnectionModelGroups] fetchProviderModels failed for ${subProvider}`,
            message,
          )
        })
    }

    return () => {
      cancelled = true
    }
  }, [authAccounts, providerSettings])

  const groups: ModelGroup[] = []

  for (const providerGroup of providerModels) {
    const config = providerSettings[providerGroup.provider]
    if (config?.enabled && config.apiKey?.trim()) {
      groups.push({
        key: `${providerGroup.provider}:api-key`,
        label: `${providerGroup.displayName} (API Key)`,
        provider: providerGroup.provider,
        authMethod: 'api-key',
        models: apiKeyModels[providerGroup.provider] ?? providerGroup.models,
      })
    }
  }

  for (const subProvider of SUBSCRIPTION_PROVIDER_ORDER) {
    const account = authAccounts[subProvider]
    if (!account?.connected) continue
    const meta = SUBSCRIPTION_META[subProvider]
    groups.push({
      key: `${subProvider}:subscription`,
      label: meta.name,
      subtitle: 'subscription',
      provider: subProvider,
      authMethod: 'subscription',
      models: subscriptionModels[subProvider] ?? [],
    })
  }

  return groups
}
