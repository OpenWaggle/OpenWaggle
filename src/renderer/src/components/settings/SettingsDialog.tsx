import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { ApiKeyForm } from './ApiKeyForm'

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps): React.JSX.Element {
  const { settings, isTestingKey, testResults, updateApiKey, testApiKey } = useSettings()
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
        // Close when clicking the backdrop (the dialog element itself, outside the content)
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
              testResult={testResults.anthropic}
            />
            <ApiKeyForm
              provider="openai"
              label="OpenAI"
              currentKey={settings.providers.openai.apiKey}
              onSave={(key) => updateApiKey('openai', key)}
              onTest={(key) => testApiKey('openai', key)}
              isTestingKey={isTestingKey}
              testResult={testResults.openai}
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
    </dialog>
  )
}
