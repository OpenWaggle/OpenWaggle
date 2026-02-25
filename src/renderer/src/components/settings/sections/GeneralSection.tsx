import type { Settings } from '@shared/types/settings'
import { AlertTriangle } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
import { ApiKeyForm } from '../ApiKeyForm'
import { BaseUrlInput } from '../BaseUrlInput'

function hasAnyApiKey(settings: Settings): boolean {
  return Object.values(settings.providers).some((config) => config && config.apiKey.length > 0)
}

function EncryptionWarning({ settings }: { settings: Settings }): React.JSX.Element | null {
  if (settings.encryptionAvailable || !hasAnyApiKey(settings)) return null

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/6 px-3 py-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
      <p className="text-[13px] text-warning/90">
        Your API keys are stored unencrypted. Install a system keyring to enable encryption.
      </p>
    </div>
  )
}

export function GeneralSection(): React.JSX.Element {
  const {
    settings,
    loadError,
    testingProviders,
    testResults,
    providerModels,
    updateApiKey,
    toggleProvider,
    updateBaseUrl,
    testApiKey,
    setBrowserHeadless,
    retryLoad,
  } = useSettings()

  return (
    <div className="space-y-6">
      <h2 className="text-[20px] font-semibold text-text-primary">General</h2>

      {loadError && (
        <div className="flex items-start gap-2.5 rounded-lg border border-error/25 bg-error/6 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-error mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-error/90">{loadError}</p>
            <button
              type="button"
              onClick={retryLoad}
              className="mt-1.5 rounded-md bg-error/10 px-2.5 py-1 text-[13px] font-medium text-error hover:bg-error/20 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <EncryptionWarning settings={settings} />

      {/* Providers */}
      <div className="rounded-lg border border-border bg-[#111418] p-5">
        <h3 className="text-sm font-medium text-text-secondary mb-4">Providers</h3>
        <div className="space-y-5">
          {providerModels.map((providerInfo) => {
            const providerId = providerInfo.provider
            const config = settings.providers[providerId]
            const enabled = config?.enabled ?? false
            const isTesting = testingProviders[providerId] ?? false

            return (
              <div key={providerId} className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">
                    {providerInfo.displayName}
                  </span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggleProvider(providerId, e.target.checked)}
                      className="sr-only peer"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`Enable ${providerInfo.displayName}`}
                    />
                    <div
                      className={cn(
                        'w-9 h-5 rounded-full transition-colors',
                        'bg-bg-tertiary peer-checked:bg-accent',
                        'after:content-[""] after:absolute after:top-0.5 after:left-[2px]',
                        'after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all',
                        'peer-checked:after:translate-x-full',
                      )}
                    />
                  </label>
                </div>

                {enabled && (
                  <div className="pl-0 space-y-3">
                    {providerInfo.requiresApiKey && (
                      <ApiKeyForm
                        provider={providerId}
                        label={providerInfo.displayName}
                        createKeyUrl={providerInfo.apiKeyManagementUrl}
                        currentKey={config?.apiKey ?? ''}
                        onSave={(key) => updateApiKey(providerId, key)}
                        onTest={(key) => testApiKey(providerId, key, config?.baseUrl)}
                        isTesting={isTesting}
                        testResult={testResults[providerId] ?? null}
                      />
                    )}

                    {providerInfo.supportsBaseUrl && (
                      <BaseUrlInput
                        providerId={providerId}
                        value={config?.baseUrl ?? ''}
                        onSave={(url) => updateBaseUrl(providerId, url)}
                      />
                    )}

                    {!providerInfo.requiresApiKey && (
                      <button
                        type="button"
                        onClick={() => testApiKey(providerId, '', config?.baseUrl)}
                        disabled={isTesting}
                        className={cn(
                          'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          !isTesting
                            ? 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                            : 'bg-bg-tertiary text-text-muted cursor-not-allowed',
                        )}
                      >
                        {isTesting ? 'Testing...' : 'Test Connection'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Browser */}
      <div className="rounded-lg border border-border bg-[#111418] p-5">
        <h3 className="text-sm font-medium text-text-secondary mb-3">Browser</h3>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-text-primary">Show browser window</span>
            <p className="text-[13px] text-text-tertiary mt-0.5">
              When enabled, browser tools open a visible Chromium window instead of running
              headless.
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={!settings.browserHeadless}
              onChange={(e) => setBrowserHeadless(!e.target.checked)}
              className="sr-only peer"
              role="switch"
              aria-checked={!settings.browserHeadless}
              aria-label="Show browser window"
            />
            <div
              className={cn(
                'w-9 h-5 rounded-full transition-colors',
                'bg-bg-tertiary peer-checked:bg-accent',
                'after:content-[""] after:absolute after:top-0.5 after:left-[2px]',
                'after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all',
                'peer-checked:after:translate-x-full',
              )}
            />
          </label>
        </div>
      </div>

      <p className="text-[13px] text-text-tertiary">
        API keys are stored locally on your machine and never sent anywhere except to the respective
        API providers.
      </p>
    </div>
  )
}
