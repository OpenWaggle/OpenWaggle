import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { isProvider, type Settings } from '@shared/types/settings'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { ModelSelectorDropdown } from './ModelSelectorDropdown'
import type { FlatModel } from './types'

interface ModelSelectorProps {
  value: SupportedModelId
  onChange: (model: SupportedModelId, authMethod?: 'api-key' | 'subscription') => void
  settings: Settings
  providerModels: ProviderInfo[]
  className?: string
}

const MODEL_KEY_MIN_PARTS = 3
const MODEL_KEY_MODEL_ID_START_INDEX = 2

/**
 * enabledModels uses namespaced keys: "provider:authMethod:modelId"
 * Each key produces one FlatModel entry — preserving the correct connection (authMethod + provider).
 * A model like "gpt-5.4" can appear twice: once for openai:api-key, once for openai:subscription.
 */
function buildFlatModels(providerModels: readonly ProviderInfo[], settings: Settings): FlatModel[] {
  if (settings.enabledModels.length === 0) return []

  // Build a fast lookup: "provider:modelId" -> display name
  const modelNameLookup = new Map<string, string>()
  for (const group of providerModels) {
    for (const model of group.models) {
      const trimmedId = model.id.trim()
      if (trimmedId) {
        modelNameLookup.set(`${group.provider}:${trimmedId}`, model.name.trim() || trimmedId)
      }
    }
  }

  const models: FlatModel[] = []
  const seen = new Set<string>() // dedupe by full namespaced key

  for (const key of settings.enabledModels) {
    if (seen.has(key)) continue
    seen.add(key)

    const parts = key.split(':')
    let provider: string
    let authMethod: 'api-key' | 'subscription'
    let modelId: string

    if (parts.length >= MODEL_KEY_MIN_PARTS) {
      provider = parts[0]
      const rawMethod = parts[1]
      if (rawMethod !== 'api-key' && rawMethod !== 'subscription') continue
      authMethod = rawMethod
      modelId = parts.slice(MODEL_KEY_MODEL_ID_START_INDEX).join(':')
    } else {
      // Legacy bare model ID — skip (no connection context)
      continue
    }

    if (!isProvider(provider)) continue

    // Look up display name from providerModels; fall back to modelId
    const name = modelNameLookup.get(`${provider}:${modelId}`) ?? modelId

    models.push({
      id: SupportedModelId(modelId),
      name,
      provider,
      authMethod,
    })
  }

  // Group by provider so models from the same provider stay together
  models.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
    return 0 // preserve original order within provider
  })

  return models
}

export function ModelSelector({
  value,
  onChange,
  settings,
  providerModels,
  className,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  // Track the auth method of the last selection so the correct entry gets the checkmark
  // when the same model ID exists in multiple connections.
  const [selectedAuthMethod, setSelectedAuthMethod] = useState<
    'api-key' | 'subscription' | undefined
  >()
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const flatModels = buildFlatModels(providerModels, settings)
  // Find the selected model — match authMethod when available for disambiguation
  const selectedModel =
    flatModels.find(
      (m) =>
        m.id === value && (selectedAuthMethod === undefined || m.authMethod === selectedAuthMethod),
    ) ?? flatModels.find((m) => m.id === value)

  // Outside-click handler
  useEffect(() => {
    if (!isOpen) return

    function onMouseDown(event: MouseEvent): void {
      if (!(event.target instanceof Node)) return
      if (ref.current?.contains(event.target)) return
      if (dropdownRef.current?.contains(event.target)) return
      setIsOpen(false)
    }

    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [isOpen])

  function selectModel(model: FlatModel): void {
    setSelectedAuthMethod(model.authMethod)
    onChange(model.id, model.authMethod)
    setIsOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsOpen(false)
    }
  }

  function triggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      setIsOpen(true)
    }
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={triggerKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={cn(
          'no-drag flex h-[26px] items-center gap-[5px] rounded-md border border-button-border px-2.5 transition-colors hover:bg-bg-hover hover:text-text-primary',
          selectedModel ? 'text-text-secondary' : 'text-text-muted',
        )}
      >
        <span className="max-w-[180px] truncate text-[12px]">
          {selectedModel?.name ?? 'Select model'}
        </span>
        <span className="text-[9px] text-text-tertiary">&#x2228;</span>
      </button>

      {isOpen && (
        <ModelSelectorDropdown
          dropdownRef={dropdownRef}
          models={flatModels}
          selectedModel={selectedModel}
          onKeyDown={handleKeyDown}
          onSelectModel={selectModel}
        />
      )}
    </div>
  )
}
