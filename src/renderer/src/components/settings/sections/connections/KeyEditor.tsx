import type { ProviderInfo } from '@shared/types/llm'
import type { Provider } from '@shared/types/settings'
import { Check, ExternalLink, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePreferences, useProviders } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'

interface KeyEditorProps {
  provider: Provider
  providerInfo: ProviderInfo
  currentKey: string
  onSave: (key: string) => Promise<void>
  onTest: (key: string) => Promise<boolean>
  isTesting: boolean
  testResult: { success: boolean; error?: string } | null
  onClose: () => void
}

export function KeyEditor({
  provider,
  providerInfo,
  currentKey,
  onSave,
  onTest,
  isTesting,
  testResult,
  onClose,
}: KeyEditorProps): React.JSX.Element {
  const [value, setValue] = useState(currentKey)
  const [showKey, setShowKey] = useState(!currentKey)

  useEffect(() => {
    setValue(currentKey)
  }, [currentKey])

  const hasChanged = value !== currentKey

  async function handleSave(): Promise<void> {
    await onSave(value)
    onClose()
  }

  async function handleTest(): Promise<void> {
    await onTest(value)
  }

  return (
    <div className="border-t border-border px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-secondary">API Key</span>
        <div className="flex items-center gap-2">
          {providerInfo.apiKeyManagementUrl && (
            <a
              href={providerInfo.apiKeyManagementUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-medium text-link-yellow hover:opacity-90 transition-opacity"
            >
              Get API key
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Enter your ${providerInfo.displayName} API key`}
            className={cn(
              'w-full rounded-lg border border-input-card-border bg-bg px-3 py-2 pr-9 text-[13px] text-text-primary font-mono',
              'placeholder:text-text-muted placeholder:font-sans',
              'focus:border-border-light focus:outline-none',
              'transition-colors',
            )}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
          >
            {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>

        <button
          type="button"
          onClick={handleTest}
          disabled={!value || isTesting}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
            value && !isTesting
              ? 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-input-card-border'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-input-card-border',
          )}
        >
          {isTesting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Testing
            </>
          ) : (
            'Test'
          )}
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={!hasChanged}
          className={cn(
            'rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
            hasChanged
              ? 'bg-accent text-black hover:bg-accent/90'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-input-card-border',
          )}
        >
          Save
        </button>
      </div>

      {testResult && (
        <div
          className={cn(
            'flex items-center gap-1.5 text-[12px]',
            testResult.success ? 'text-success' : 'text-error',
          )}
        >
          {testResult.success ? (
            <>
              <Check className="h-3 w-3" />
              Connection successful
            </>
          ) : (
            <>
              <X className="h-3 w-3" />
              {testResult.error ?? 'Connection failed — check your API key'}
            </>
          )}
        </div>
      )}

      {providerInfo.supportsBaseUrl && <BaseUrlField provider={provider} />}
    </div>
  )
}

function BaseUrlField({ provider }: { provider: Provider }): React.JSX.Element {
  const { settings } = usePreferences()
  const { updateBaseUrl } = useProviders()
  const config = settings.providers[provider]
  const baseUrl = config?.baseUrl ?? ''
  const [localValue, setLocalValue] = useState(baseUrl)

  useEffect(() => {
    setLocalValue(baseUrl)
  }, [baseUrl])

  return (
    <div className="space-y-1.5">
      <span className="text-[12px] text-text-tertiary">Base URL</span>
      <input
        type="text"
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          if (localValue !== (config?.baseUrl ?? '')) {
            updateBaseUrl(provider, localValue)
          }
        }}
        placeholder="http://localhost:11434"
        className={cn(
          'w-full rounded-lg border border-input-card-border bg-bg px-3 py-2 text-[12px] text-text-primary font-mono',
          'placeholder:text-text-muted placeholder:font-sans',
          'focus:border-border-light focus:outline-none',
          'transition-colors',
        )}
      />
    </div>
  )
}
