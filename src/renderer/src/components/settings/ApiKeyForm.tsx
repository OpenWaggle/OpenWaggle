import { Check, ExternalLink, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

interface ApiKeyFormProps {
  provider: string
  label: string
  createKeyUrl?: string
  currentKey: string
  onSave: (apiKey: string) => Promise<void>
  onTest: (apiKey: string) => Promise<boolean>
  isTesting: boolean
  testResult: { success: boolean; error?: string } | null
}

export function ApiKeyForm({
  provider,
  label,
  createKeyUrl,
  currentKey,
  onSave,
  onTest,
  isTesting,
  testResult,
}: ApiKeyFormProps): React.JSX.Element {
  const [value, setValue] = useState(currentKey)
  const [prevCurrentKey, setPrevCurrentKey] = useState(currentKey)
  const [showKey, setShowKey] = useState(false)
  const hasChanged = value !== currentKey
  if (currentKey !== prevCurrentKey) {
    setPrevCurrentKey(currentKey)
    setValue(currentKey)
  }

  async function handleSave(): Promise<void> {
    await onSave(value)
  }

  async function handleTest(): Promise<void> {
    await onTest(value)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`api-key-${provider}`} className="text-sm font-medium text-text-primary">
          {label}
        </label>
        {createKeyUrl && (
          <a
            href={createKeyUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'inline-flex items-center gap-1 text-[13px] font-medium text-link-yellow transition-opacity',
              'hover:opacity-90',
            )}
          >
            Get API key
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            id={`api-key-${provider}`}
            type={showKey ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`Enter your ${label} API key`}
            className={cn(
              'w-full rounded-lg border border-border bg-bg px-3 py-2 pr-10 text-sm text-text-primary',
              'placeholder:text-text-tertiary',
              'focus:border-border-light focus:outline-none',
              'transition-colors',
            )}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            aria-label={showKey ? 'Hide API key' : 'Show API key'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <button
          type="button"
          onClick={handleTest}
          disabled={!value || isTesting}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            value && !isTesting
              ? 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed',
          )}
        >
          {isTesting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Testing...
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
            'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            hasChanged
              ? 'bg-accent text-black hover:bg-accent/90'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed',
          )}
        >
          Save
        </button>
      </div>

      {testResult && (
        <div
          className={cn(
            'flex items-center gap-1.5 text-[13px]',
            testResult.success ? 'text-success' : 'text-error',
          )}
        >
          {testResult.success ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Connection successful
            </>
          ) : (
            <>
              <X className="h-3.5 w-3.5" />
              {testResult.error ?? 'Connection failed — check your API key'}
            </>
          )}
        </div>
      )}
    </div>
  )
}
