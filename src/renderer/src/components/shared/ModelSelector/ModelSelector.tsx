import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatContextWindow } from '@/lib/format-tokens'
import { ModelSelectorDropdown } from './ModelSelectorDropdown'
import { ProviderModelIcon, resolveIconColor } from './provider-icon'
import type { FlatModel } from './types'

interface ModelSelectorProps {
  value: SupportedModelId
  onChange: (model: SupportedModelId) => void
  settings: Settings
  providerModels: ProviderInfo[]
  className?: string
}

/**
 * enabledModels contains canonical Pi refs: "provider/modelId".
 * The composer only shows curated models that Pi currently reports as runnable.
 */
function buildFlatModels(providerModels: readonly ProviderInfo[], settings: Settings): FlatModel[] {
  if (settings.enabledModels.length === 0) return []

  const modelLookup = new Map<string, FlatModel>()
  for (const group of providerModels) {
    for (const model of group.models) {
      const modelRef = model.id.trim()
      if (!modelRef || !model.available) continue

      modelLookup.set(modelRef, {
        id: SupportedModelId(modelRef),
        modelId: model.modelId,
        name: model.name.trim() || model.modelId,
        provider: group.provider,
        providerName: group.displayName,
        contextWindowLabel: model.contextWindow
          ? formatContextWindow(model.contextWindow)
          : undefined,
      })
    }
  }

  const models: FlatModel[] = []
  const seen = new Set<string>()

  for (const key of settings.enabledModels) {
    const modelRef = key.trim()
    if (seen.has(modelRef)) continue
    seen.add(modelRef)

    const model = modelLookup.get(modelRef)
    if (model) models.push(model)
  }

  // Group by provider so models from the same provider stay together
  models.sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
    return 0 // preserve original order within provider
  })

  return models
}

interface SelectedModelIconProps {
  readonly provider: FlatModel['provider']
}

function SelectedModelIcon({ provider }: SelectedModelIconProps) {
  const color = resolveIconColor(provider)
  return (
    <ProviderModelIcon provider={provider} className="h-3.5 w-3.5 shrink-0" style={{ color }} />
  )
}

export function ModelSelector({
  value,
  onChange,
  settings,
  providerModels,
  className,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const flatModels = buildFlatModels(providerModels, settings)
  const selectedModel = flatModels.find((m) => m.id === value)

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
    onChange(model.id)
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
        {selectedModel && <SelectedModelIcon provider={selectedModel.provider} />}
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
