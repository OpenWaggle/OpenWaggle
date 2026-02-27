import type { Provider } from '@shared/types/settings'
import { useState } from 'react'
import { WarningCallout } from '@/components/settings/common/WarningCallout'
import { useAuth, usePreferences, useProviders } from '@/hooks/useSettings'
import { AddProviderRow } from './connections/AddProviderRow'
import { hasAnyApiKey } from './connections/helpers'
import { SUBSCRIPTION_PROVIDER_ORDER } from './connections/meta'
import { ProviderRow } from './connections/ProviderRow'
import { SubscriptionRow } from './connections/SubscriptionRow'

export function ConnectionsSection(): React.JSX.Element {
  const { settings } = usePreferences()
  const { providerModels, modelFetchErrors, toggleProvider } = useProviders()
  const { oauthStatuses, authAccounts, startOAuth, submitAuthCode, disconnectAuth } = useAuth()

  const showUnencryptedWarning = !settings.encryptionAvailable && hasAnyApiKey(settings.providers)
  const showManualResaveWarning = settings.apiKeysRequireManualResave

  const configuredProviders = providerModels.filter((providerInfo) => {
    const config = settings.providers[providerInfo.provider]
    return config?.enabled || (config?.apiKey && config.apiKey.length > 0)
  })

  const unconfiguredProviders = providerModels.filter((providerInfo) => {
    const config = settings.providers[providerInfo.provider]
    return !config?.enabled && (!config?.apiKey || config.apiKey.length === 0)
  })

  const [justAddedProvider, setJustAddedProvider] = useState<Provider | null>(null)

  function handleAddProvider(provider: Provider): void {
    toggleProvider(provider, true)
    setJustAddedProvider(provider)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-[20px] font-semibold text-text-primary">Connections</h2>
        <p className="text-[13px] text-text-tertiary">
          Manage API keys and SDK connections for your AI providers.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text-primary">API Keys</h3>

        {showUnencryptedWarning && (
          <WarningCallout>
            <p>Your API keys are stored unencrypted on this system.</p>
            <p className="mt-1">
              What to do: enable your OS credential store (macOS Keychain, Windows Credential
              Manager, or Linux gnome-keyring/kwallet), restart OpenHive, then open this page and
              save each API key again so it is re-encrypted.
            </p>
          </WarningCallout>
        )}

        {showManualResaveWarning && (
          <WarningCallout>
            <p>We could not re-encrypt one or more saved API keys automatically.</p>
            <p className="mt-1">
              Please open each configured provider key and click Save again to encrypt it.
            </p>
          </WarningCallout>
        )}

        {configuredProviders.length > 0 && (
          <div className="rounded-lg border border-border bg-[#111418] overflow-hidden">
            {configuredProviders.map((providerInfo, index) => (
              <ProviderRow
                key={providerInfo.provider}
                providerInfo={providerInfo}
                isLast={index === configuredProviders.length - 1}
                autoEdit={justAddedProvider === providerInfo.provider}
                onEditingChange={(editing) => {
                  if (!editing && justAddedProvider === providerInfo.provider) {
                    setJustAddedProvider(null)
                  }
                }}
                fetchError={modelFetchErrors[providerInfo.provider]}
              />
            ))}
          </div>
        )}

        <AddProviderRow availableProviders={unconfiguredProviders} onAdd={handleAddProvider} />
      </div>

      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text-primary">Subscription Connections</h3>
        <p className="text-[12px] text-text-tertiary max-w-[500px]">
          Sign in with your existing provider subscriptions. Toggle to connect or disconnect at any
          time.
        </p>

        <div className="rounded-lg border border-border bg-[#111418] overflow-hidden">
          {SUBSCRIPTION_PROVIDER_ORDER.map((provider, index) => (
            <SubscriptionRow
              key={provider}
              provider={provider}
              accountInfo={authAccounts[provider]}
              oauthStatus={oauthStatuses[provider] ?? { type: 'idle' }}
              onSignIn={() => startOAuth(provider)}
              onDisconnect={() => disconnectAuth(provider)}
              onSubmitCode={(code) => submitAuthCode(provider, code)}
              isLast={index === SUBSCRIPTION_PROVIDER_ORDER.length - 1}
            />
          ))}
        </div>
      </div>

      <p className="text-[13px] text-text-tertiary">
        API keys are stored locally on your machine and never sent anywhere except to the respective
        API providers.
      </p>
    </div>
  )
}
