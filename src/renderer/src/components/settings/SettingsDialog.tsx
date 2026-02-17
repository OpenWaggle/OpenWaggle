import { PROVIDERS } from '@shared/types/settings'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
import { ApiKeyForm } from './ApiKeyForm'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  grok: 'Grok',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
}

/** Whether a provider requires an API key (matches ProviderDefinition on main side) */
const PROVIDER_REQUIRES_KEY: Record<string, boolean> = {
  anthropic: true,
  openai: true,
  gemini: true,
  grok: true,
  openrouter: true,
  ollama: false,
}

/** Whether a provider supports a configurable base URL */
const PROVIDER_SUPPORTS_BASE_URL: Record<string, boolean> = {
  anthropic: false,
  openai: false,
  gemini: false,
  grok: false,
  openrouter: false,
  ollama: true,
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps): React.JSX.Element {
  const {
    settings,
    isTestingKey,
    testResults,
    updateApiKey,
    toggleProvider,
    updateBaseUrl,
    testApiKey,
  } = useSettings()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (isOpen && !dialog.open) {
      dialog.showModal()
    } else if (!isOpen && dialog.open) {
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
          className="rounded-md p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-6 px-6 py-5 max-h-[70vh] overflow-y-auto">
        <div>
          <h3 className="text-sm font-medium text-text-secondary mb-4">Providers</h3>
          <div className="space-y-5">
            {PROVIDERS.map((providerId) => {
              const config = settings.providers[providerId]
              const label = PROVIDER_LABELS[providerId] ?? providerId
              const requiresKey = PROVIDER_REQUIRES_KEY[providerId] ?? true
              const supportsBaseUrl = PROVIDER_SUPPORTS_BASE_URL[providerId] ?? false
              const enabled = config?.enabled ?? false

              return (
                <div key={providerId} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary">{label}</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => toggleProvider(providerId, e.target.checked)}
                        className="sr-only peer"
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
                      {requiresKey && (
                        <ApiKeyForm
                          provider={providerId}
                          label={label}
                          currentKey={config?.apiKey ?? ''}
                          onSave={(key) => updateApiKey(providerId, key)}
                          onTest={(key) => testApiKey(providerId, key, config?.baseUrl)}
                          isTestingKey={isTestingKey}
                          testResult={testResults[providerId] ?? null}
                        />
                      )}

                      {supportsBaseUrl && (
                        <div className="space-y-1.5">
                          <label
                            htmlFor={`base-url-${providerId}`}
                            className="text-xs text-text-secondary"
                          >
                            Base URL
                          </label>
                          <input
                            id={`base-url-${providerId}`}
                            type="text"
                            value={config?.baseUrl ?? ''}
                            onChange={(e) => updateBaseUrl(providerId, e.target.value)}
                            placeholder="http://localhost:11434"
                            className={cn(
                              'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary',
                              'placeholder:text-text-muted',
                              'focus:border-border-light focus:outline-none',
                              'transition-colors',
                            )}
                          />
                        </div>
                      )}

                      {!requiresKey && (
                        <button
                          type="button"
                          onClick={() => testApiKey(providerId, '', config?.baseUrl)}
                          disabled={isTestingKey}
                          className={cn(
                            'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            !isTestingKey
                              ? 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                              : 'bg-bg-tertiary text-text-muted cursor-not-allowed',
                          )}
                        >
                          Test Connection
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-xs text-text-muted">
            API keys are stored locally on your machine and never sent anywhere except to the
            respective API providers.
          </p>
        </div>
      </div>
    </dialog>
  )
}
