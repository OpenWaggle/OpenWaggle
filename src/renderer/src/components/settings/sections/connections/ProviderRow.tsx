import type { ProviderInfo } from '@shared/types/llm'
import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { WarningCallout } from '@/components/settings/common/WarningCallout'
import { usePreferences, useProviders } from '@/hooks/useSettings'
import { cn } from '@/lib/cn'
import { maskApiKey } from './helpers'
import { KeyEditor } from './KeyEditor'
import { PROVIDER_META } from './meta'

interface ProviderRowProps {
  providerInfo: ProviderInfo
  isLast: boolean
  autoEdit?: boolean
  onEditingChange?: (editing: boolean) => void
  fetchError?: string
}

export function ProviderRow({
  providerInfo,
  isLast,
  autoEdit,
  onEditingChange,
  fetchError,
}: ProviderRowProps) {
  const { settings } = usePreferences()
  const { testingProviders, testResults, updateApiKey, testApiKey } = useProviders()

  const [editing, setEditing] = useState(Boolean(autoEdit))
  const providerId = providerInfo.provider
  const config = settings.providers[providerId]
  const meta = PROVIDER_META[providerId]
  const currentKey = config?.apiKey ?? ''
  const masked = maskApiKey(currentKey)
  const isTesting = testingProviders[providerId] ?? false

  const Icon = meta.icon

  return (
    <div className={cn(!isLast && 'border-b border-border')}>
      <div className="flex items-center justify-between h-16 px-5">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: meta.color }} />
            <span className="text-[13px] font-medium text-text-primary">
              {providerInfo.displayName}
            </span>
          </div>
          <span className="text-[12px] text-text-tertiary">{meta.description}</span>
        </div>

        <div className="flex items-center gap-2.5">
          {currentKey && (
            <div className="flex items-center rounded-[5px] border border-input-card-border bg-[#1a1f28] px-3 h-7">
              <span className="text-[11px] text-text-tertiary font-mono">{masked}</span>
            </div>
          )}
          <button
            type="button"
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
          provider={providerId}
          providerInfo={providerInfo}
          currentKey={currentKey}
          onSave={(key) => updateApiKey(providerId, key)}
          onTest={(key) => testApiKey(providerId, key, config?.baseUrl)}
          isTesting={isTesting}
          testResult={testResults[providerId] ?? null}
          onClose={() => {
            setEditing(false)
            onEditingChange?.(false)
          }}
        />
      )}

      {fetchError && !editing && (
        <WarningCallout className="mx-5 mb-3" contentClassName="text-[11px] leading-relaxed">
          <p>Could not fetch models: {fetchError}</p>
        </WarningCallout>
      )}
    </div>
  )
}
