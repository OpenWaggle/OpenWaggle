import { isSubscriptionProvider } from '@shared/types/auth'
import type { Settings } from '@shared/types/settings'
import { AlertTriangle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAuth, usePreferences, useProviders } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
import { ApiKeyForm } from './ApiKeyForm'
import { SubscriptionAuthButton } from './SubscriptionAuthButton'

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

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps): React.JSX.Element {
  const { settings, loadError, setBrowserHeadless, retryLoad } = usePreferences()
  const {
    testingProviders,
    testResults,
    providerModels,
    updateApiKey,
    toggleProvider,
    updateBaseUrl,
    testApiKey,
  } = useProviders()
  const { oauthStatuses, authAccounts, startOAuth, disconnectAuth } = useAuth()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen && !dialog.open) {
      dialog.showModal()
    }
    if (!isOpen && dialog.open) {
      dialog.close()
    }
  }, [isOpen])

  // Handle native close event (Escape key, etc.)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    function handleClose(): void {
      onClose()
    }

    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [onClose])

  return (
    <dialog
      ref={dialogRef}
      className="w-full max-w-lg rounded-xl border border-border bg-bg-secondary shadow-2xl backdrop:bg-black/60 p-0"
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose()
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose()
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="text-base font-semibold text-text-primary">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-text-tertiary hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-6 px-6 py-5 max-h-[70vh] overflow-y-auto">
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
        <div>
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
                      {providerInfo.supportsSubscription && isSubscriptionProvider(providerId) && (
                        <>
                          <SubscriptionAuthButton
                            provider={providerId}
                            providerDisplayName={providerInfo.displayName}
                            accountInfo={authAccounts[providerId]}
                            oauthStatus={oauthStatuses[providerId] ?? { type: 'idle' }}
                            onSignIn={() => startOAuth(providerId)}
                            onDisconnect={() => disconnectAuth(providerId)}
                          />
                          {config?.authMethod !== 'subscription' && (
                            <div className="flex items-center gap-3 text-[12px] text-text-tertiary">
                              <div className="flex-1 border-t border-border" />
                              or enter API key manually
                              <div className="flex-1 border-t border-border" />
                            </div>
                          )}
                        </>
                      )}

                      {config?.authMethod !== 'subscription' && (
                        <>
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
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="border-t border-border pt-4">
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

        <div className="border-t border-border pt-4">
          <p className="text-[13px] text-text-tertiary">
            API keys are stored locally on your machine and never sent anywhere except to the
            respective API providers.
          </p>
        </div>
      </div>
    </dialog>
  )
}

/** Base URL input that only saves on blur, not on every keystroke */
function BaseUrlInput({
  providerId,
  value,
  onSave,
}: {
  providerId: string
  value: string
  onSave: (url: string) => void
}): React.JSX.Element {
  const [localValue, setLocalValue] = useState(value)

  // Sync from parent if external update
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  return (
    <div className="space-y-1.5">
      <label htmlFor={`base-url-${providerId}`} className="text-[13px] text-text-secondary">
        Base URL
      </label>
      <input
        id={`base-url-${providerId}`}
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          if (localValue !== value) {
            onSave(localValue)
          }
        }}
        placeholder="http://localhost:11434"
        className={cn(
          'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary',
          'placeholder:text-text-tertiary',
          'focus:border-border-light focus:outline-none',
          'transition-colors',
        )}
      />
    </div>
  )
}
