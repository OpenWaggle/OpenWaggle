import type { ProviderInfo } from '@shared/types/llm'
import { Check, ExternalLink, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'

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

  async function handleSave() {
    await onSave(draftValue)
    setValue('')
    onClose()
  }

  async function handleClear() {
    await onClear()
    setValue('')
    onClose()
  }

  return (
    <div className="border-t border-border px-5 py-4 space-y-3">
      <KeyEditorHeader providerInfo={providerInfo} onClose={onClose} />
      <div className="flex items-center gap-2">
        <KeyInput
          providerInfo={providerInfo}
          hasStoredKey={hasStoredKey}
          state={{ value: draftValue, showKey }}
          actions={{
            onChange: setValue,
            onToggleVisibility: () => setShowKey((current) => !current),
          }}
        />
        <KeyEditorButtons
          state={{ draftValue, hasStoredKey, isTesting }}
          actions={{
            onTest: () => void onTest(draftValue),
            onSave: () => void handleSave(),
            onClear: () => void handleClear(),
          }}
        />
      </div>
      <KeyTestResult result={testResult} />
      {providerInfo.auth.apiKeySource === 'environment-or-custom' && <EnvironmentKeyNotice />}
    </div>
  )
}

function KeyEditorHeader({
  providerInfo,
  onClose,
}: {
  readonly providerInfo: ProviderInfo
  readonly onClose: () => void
}) {
  return (
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
            <ExternalLink className="size-3" />
          </a>
        )}
        <Button
          variant="unstyled"
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function KeyInput({
  providerInfo,
  hasStoredKey,
  state,
  actions,
}: {
  readonly providerInfo: ProviderInfo
  readonly hasStoredKey: boolean
  readonly state: { readonly value: string; readonly showKey: boolean }
  readonly actions: {
    readonly onChange: (value: string) => void
    readonly onToggleVisibility: () => void
  }
}) {
  return (
    <div className="relative flex-1">
      <TextInput
        type={state.showKey ? 'text' : 'password'}
        value={state.value}
        onChange={(event) => actions.onChange(event.target.value)}
        placeholder={
          hasStoredKey
            ? `Enter a new ${providerInfo.displayName} key to replace the stored key`
            : `Enter your ${providerInfo.displayName} API key`
        }
        monospace
        className="rounded-lg border-input-card-border pr-9 text-[13px] placeholder:text-text-muted focus:border-border-light"
      />
      <Button
        variant="unstyled"
        type="button"
        onClick={actions.onToggleVisibility}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
      >
        {state.showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </Button>
    </div>
  )
}

function KeyEditorButtons({
  state,
  actions,
}: {
  readonly state: {
    readonly draftValue: string
    readonly hasStoredKey: boolean
    readonly isTesting: boolean
  }
  readonly actions: {
    readonly onTest: () => void
    readonly onSave: () => void
    readonly onClear: () => void
  }
}) {
  return (
    <>
      <Button
        variant="unstyled"
        type="button"
        onClick={actions.onTest}
        disabled={!state.draftValue || state.isTesting}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
          state.draftValue && !state.isTesting
            ? 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-input-card-border'
            : 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-input-card-border',
        )}
      >
        {state.isTesting ? (
          <>
            <Loader2 className="size-3.5 animate-spin" />
            Testing
          </>
        ) : (
          'Test'
        )}
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={actions.onSave}
        disabled={!state.draftValue}
        className={cn(
          'rounded-md px-3 py-2 text-[12px] font-medium transition-colors',
          state.draftValue
            ? 'bg-accent text-black hover:bg-accent/90'
            : 'bg-bg-tertiary text-text-muted cursor-not-allowed border border-input-card-border',
        )}
      >
        Save
      </Button>
      {state.hasStoredKey && (
        <Button
          variant="unstyled"
          type="button"
          onClick={actions.onClear}
          className="rounded-md border border-input-card-border bg-bg-tertiary px-3 py-2 text-[12px] font-medium text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          Clear
        </Button>
      )}
    </>
  )
}

function KeyTestResult({ result }: { readonly result: KeyEditorProps['testResult'] }) {
  if (!result) return null
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-[12px]',
        result.success ? 'text-success' : 'text-error',
      )}
    >
      {result.success ? (
        <>
          <Check className="size-3" />
          Connection successful
        </>
      ) : (
        <>
          <X className="size-3" />
          {result.error ?? 'Connection failed — check your API key'}
        </>
      )}
    </div>
  )
}

function EnvironmentKeyNotice() {
  return (
    <p className="text-[11px] text-text-tertiary">
      Pi currently sees this provider through environment variables, cloud credentials, or a custom
      models.json provider.
    </p>
  )
}
