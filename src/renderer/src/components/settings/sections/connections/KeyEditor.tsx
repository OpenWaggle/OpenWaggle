import type { ProviderInfo } from '@shared/types/llm'
import { Check, ExternalLink, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

interface KeyEditorProps {
  providerInfo: ProviderInfo
  onSave: (key: string) => Promise<void>
  onClear: () => Promise<void>
  onTest: (key: string) => Promise<boolean>
  isTesting: boolean
  testResult: { success: boolean; error?: string } | null
  onClose: () => void
}

export function KeyEditor({
  providerInfo,
  onSave,
  onClear,
  onTest,
  isTesting,
  testResult,
  onClose,
}: KeyEditorProps) {
  const [value, setValue] = useState('')
  const [showKey, setShowKey] = useState(false)
  const draftValue = value.trim()
  const hasStoredKey = providerInfo.auth.apiKeySource === 'api-key'

  async function handleSave(): Promise<void> {
    await onSave(draftValue)
    setValue('')
    onClose()
  }

  async function handleClear(): Promise<void> {
    await onClear()
    setValue('')
    onClose()
  }

  async function handleTest(): Promise<void> {
    await onTest(draftValue)
  }

  return (
    <div className="border-t border-border px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-text-secondary">Pi Auth Key</span>
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
            value={draftValue}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              hasStoredKey
                ? `Enter a new ${providerInfo.displayName} key to replace the stored key`
                : `Enter your ${providerInfo.displayName} API key`
            }
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
          disabled={!draftValue || isTesting}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
            draftValue && !isTesting
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
          disabled={!draftValue}
          className={cn(
            'rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
            draftValue
              ? 'bg-accent text-black hover:bg-accent/90'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-input-card-border',
          )}
        >
          Save
        </button>

        {hasStoredKey && (
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md border border-input-card-border bg-bg-tertiary px-3 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          >
            Clear
          </button>
        )}
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

      {providerInfo.auth.apiKeySource === 'environment-or-custom' && (
        <p className="text-[11px] text-text-tertiary">
          Pi currently sees this provider through environment variables, cloud credentials, or a
          custom models.json provider.
        </p>
      )}
    </div>
  )
}
