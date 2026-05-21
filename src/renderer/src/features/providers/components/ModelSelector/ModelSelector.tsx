import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { formatContextWindow } from '@/shared/lib/format-tokens'
import { Button } from '@/shared/ui/Button'
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
function toFlatModel(group: ProviderInfo, model: ProviderInfo['models'][number]) {
  const modelRef = model.id.trim()
  if (!modelRef || !model.available) return null

  return {
    id: SupportedModelId(modelRef),
    modelId: model.modelId,
    name: model.name.trim() || model.modelId,
    provider: group.provider,
    providerName: group.displayName,
    contextWindowLabel: model.contextWindow ? formatContextWindow(model.contextWindow) : undefined,
  } satisfies FlatModel
}

function buildAvailableModelLookup(providerModels: readonly ProviderInfo[]) {
  const modelLookup = new Map<string, FlatModel>()

  for (const group of providerModels) {
    for (const model of group.models) {
      const flatModel = toFlatModel(group, model)
      if (flatModel) modelLookup.set(flatModel.id, flatModel)
    }
  }

  return modelLookup
}

function readEnabledModel(
  modelKey: string,
  modelLookup: ReadonlyMap<string, FlatModel>,
  seen: Set<string>,
) {
  const modelRef = modelKey.trim()
  if (seen.has(modelRef)) return null

  seen.add(modelRef)
  return modelLookup.get(modelRef) ?? null
}

function sortModelsByProvider(models: FlatModel[]) {
  return models.slice().sort((a, b) => {
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
    return 0
  })
}

function buildFlatModels(providerModels: readonly ProviderInfo[], settings: Settings) {
  if (settings.enabledModels.length === 0) return []

  const modelLookup = buildAvailableModelLookup(providerModels)
  const models: FlatModel[] = []
  const seen = new Set<string>()

  for (const key of settings.enabledModels) {
    const model = readEnabledModel(key, modelLookup, seen)
    if (model) models.push(model)
  }

  return sortModelsByProvider(models)
}

interface SelectedModelIconProps {
  readonly provider: FlatModel['provider']
}

function SelectedModelIcon({ provider }: SelectedModelIconProps) {
  const color = resolveIconColor(provider)
  return <ProviderModelIcon provider={provider} className="size-3.5 shrink-0" style={{ color }} />
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

    function onMouseDown(event: MouseEvent) {
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

  function selectModel(model: FlatModel) {
    onChange(model.id)
    setIsOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      setIsOpen(false)
    }
  }

  function triggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      setIsOpen(true)
    }
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <Button
        variant="unstyled"
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
      </Button>

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
