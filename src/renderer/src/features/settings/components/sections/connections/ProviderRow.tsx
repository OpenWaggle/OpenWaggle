import type { ProviderInfo } from '@shared/types/llm'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useProviders } from '@/features/settings/hooks/useSettings'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { KeyEditor } from './KeyEditor'
import { getProviderMeta } from './meta'

interface ProviderRowProps {
  providerInfo: ProviderInfo
  isLast: boolean
  autoEdit?: boolean
  onEditingChange?: (editing: boolean) => void
}

export function ProviderRow({ providerInfo, isLast, autoEdit, onEditingChange }: ProviderRowProps) {
  const { testingProviders, testResults, updateApiKey, testApiKey } = useProviders()

  const [editing, setEditing] = useState(Boolean(autoEdit))
  const providerId = providerInfo.provider
  const meta = getProviderMeta(providerId)
  const isTesting = testingProviders[providerId] ?? false
  const isConfigured = providerInfo.auth.apiKeyConfigured

  const Icon = meta.icon
  const statusText =
    providerInfo.auth.apiKeySource === 'api-key'
      ? 'API key configured'
      : providerInfo.auth.apiKeySource === 'environment-or-custom'
        ? 'Configured outside OpenWaggle'
        : 'Not configured'
  const statusClassName = isConfigured ? 'text-success' : 'text-neutral'

  return (
    <div className={cn(!isLast && 'border-b border-border')}>
      <div className="flex items-center justify-between h-14 px-5">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn('size-3.5 shrink-0', meta.iconClassName)} />
          <span className="truncate text-xs font-medium text-text-primary">
            {providerInfo.displayName}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1 rounded-xl px-2 h-5.5">
            <div
              className={cn('size-1.5 rounded-full', isConfigured ? 'bg-success' : 'bg-neutral')}
            />
            <span className={cn('text-xs font-medium', statusClassName)}>{statusText}</span>
          </div>
          <Button
            variant="unstyled"
            type="button"
            aria-label={`Edit ${providerInfo.displayName} API key`}
            onClick={() => {
              const next = !editing
              setEditing(next)
              onEditingChange?.(next)
            }}
            className={cn(
              'flex items-center justify-center rounded-md border border-border-light bg-bg-secondary size-7',
              'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors',
            )}
          >
            <Pencil className="size-3" />
          </Button>
        </div>
      </div>

      {editing && (
        <KeyEditor
          providerInfo={providerInfo}
          onSave={(key) => updateApiKey(providerId, key)}
          onClear={() => updateApiKey(providerId, '')}
          onTest={(key) => testApiKey(providerId, key)}
          isTesting={isTesting}
          testResult={testResults[providerId] ?? null}
          onClose={() => {
            setEditing(false)
            onEditingChange?.(false)
          }}
        />
      )}
    </div>
  )
}
