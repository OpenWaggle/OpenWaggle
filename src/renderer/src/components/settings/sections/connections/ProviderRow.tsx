import type { ProviderInfo } from '@shared/types/llm'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useProviders } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
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
  const statusColor = isConfigured ? '#34d399' : '#6b7280'

  return (
    <div className={cn(!isLast && 'border-b border-border')}>
      <div className="flex items-center justify-between h-14 px-5">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
          <span className="truncate text-[13px] font-medium text-text-primary">
            {providerInfo.displayName}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1 rounded-[10px] px-2 h-[22px]">
            <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
            <span className="text-[11px] font-medium" style={{ color: statusColor }}>
              {statusText}
            </span>
          </div>
          <button
            type="button"
            aria-label={`Edit ${providerInfo.displayName} API key`}
            onClick={() => {
              const next = !editing
              setEditing(next)
              onEditingChange?.(next)
            }}
            className={cn(
              'flex items-center justify-center rounded-[5px] border border-input-card-border bg-[#1a1f28] h-7 w-7',
              'text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors',
            )}
          >
            <Pencil className="h-3 w-3" />
          </button>
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
