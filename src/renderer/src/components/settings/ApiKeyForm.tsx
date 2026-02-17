import type { Provider } from '@shared/types/settings'
import { Check, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

interface ApiKeyFormProps {
  provider: Provider
  label: string
  currentKey: string
  onSave: (apiKey: string) => Promise<void>
  onTest: (apiKey: string) => Promise<boolean>
  isTestingKey: boolean
  testResult: { provider: Provider; success: boolean } | null
}

export function ApiKeyForm({
  provider,
  label,
  currentKey,
  onSave,
  onTest,
  isTestingKey,
  testResult,
}: ApiKeyFormProps): React.JSX.Element {
  const [value, setValue] = useState(currentKey)
  const [showKey, setShowKey] = useState(false)
  const hasChanged = value !== currentKey

  async function handleSave(): Promise<void> {
    await onSave(value)
  }

  async function handleTest(): Promise<void> {
    await onTest(value)
  }

  const showTestResult = testResult?.provider === provider

  return (
    <div className="space-y-2">
      <label htmlFor={`api-key-${provider}`} className="text-sm font-medium text-text-primary">
        {label}
      </label>
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
              'placeholder:text-text-muted',
              'focus:border-border-light focus:outline-none',
              'transition-colors',
            )}
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        <button
          type="button"
          onClick={handleTest}
          disabled={!value || isTestingKey}
          className={cn(
            'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            value && !isTestingKey
              ? 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              : 'bg-bg-tertiary text-text-muted cursor-not-allowed',
          )}
        >
          {isTestingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
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

      {showTestResult && (
        <div
          className={cn(
            'flex items-center gap-1.5 text-xs',
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
              Connection failed — check your API key
            </>
          )}
        </div>
      )}
    </div>
  )
}
