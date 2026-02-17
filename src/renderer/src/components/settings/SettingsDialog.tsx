import { X } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import { ApiKeyForm } from './ApiKeyForm'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps): React.JSX.Element | null {
  const { settings, isTestingKey, testResult, updateApiKey, testApiKey } = useSettings()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        tabIndex={0}
        aria-label="Close settings"
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-bg-secondary shadow-2xl">
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

        <div className="space-y-6 px-6 py-5">
          <div>
            <h3 className="text-sm font-medium text-text-secondary mb-4">API Keys</h3>
            <div className="space-y-5">
              <ApiKeyForm
                provider="anthropic"
                label="Anthropic"
                currentKey={settings.providers.anthropic.apiKey}
                onSave={(key) => updateApiKey('anthropic', key)}
                onTest={(key) => testApiKey('anthropic', key)}
                isTestingKey={isTestingKey}
                testResult={testResult}
              />
              <ApiKeyForm
                provider="openai"
                label="OpenAI"
                currentKey={settings.providers.openai.apiKey}
                onSave={(key) => updateApiKey('openai', key)}
                onTest={(key) => testApiKey('openai', key)}
                isTestingKey={isTestingKey}
                testResult={testResult}
              />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-xs text-text-muted">
              API keys are stored locally on your machine and never sent anywhere except to the
              respective API providers.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
