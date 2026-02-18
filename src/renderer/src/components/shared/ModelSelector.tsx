import type { ModelDisplayInfo, ProviderInfo, SupportedModelId } from '@shared/types/llm'
import type { Provider, Settings } from '@shared/types/settings'
import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

interface ModelSelectorProps {
  value: SupportedModelId
  onChange: (model: SupportedModelId) => void
  settings: Settings
  providerModels: ProviderInfo[]
  className?: string
}

export function ModelSelector({
  value,
  onChange,
  settings,
  providerModels,
  className,
}: ModelSelectorProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)

  // Filter to only show enabled providers
  const visibleGroups = providerModels.filter((group) => {
    const config = settings.providers[group.provider]
    return !!config?.enabled
  })

  // Pre-compute flat model list and index map
  const allModels: ModelDisplayInfo[] = []
  const flatIndexMap = new Map<string, number>()
  for (const group of visibleGroups) {
    for (const model of group.models) {
      flatIndexMap.set(model.id, allModels.length)
      allModels.push(model)
    }
  }

  const selectedModel = allModels.find((m) => m.id === value)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function openDropdown(): void {
    setIsOpen(true)
    setFocusedIndex(flatIndexMap.get(value) ?? 0)
  }

  function isModelAvailable(model: ModelDisplayInfo): boolean {
    const providerInfo = providerModels.find((p) => p.provider === model.provider)
    if (providerInfo && !providerInfo.requiresApiKey) return true
    const config = settings.providers[model.provider as Provider]
    return !!config?.apiKey
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openDropdown()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        setFocusedIndex((prev) => (prev + 1) % allModels.length)
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        setFocusedIndex((prev) => (prev - 1 + allModels.length) % allModels.length)
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const model = allModels[focusedIndex]
        if (model && isModelAvailable(model)) {
          onChange(model.id)
          setIsOpen(false)
        }
        break
      }
      case 'Escape': {
        e.preventDefault()
        setIsOpen(false)
        break
      }
    }
  }

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => (isOpen ? setIsOpen(false) : openDropdown())}
        onKeyDown={handleKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="no-drag flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
      >
        <span className="truncate max-w-[180px]">{selectedModel?.name ?? value}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-activedescendant={
            focusedIndex >= 0 ? `model-option-${allModels[focusedIndex]?.id}` : undefined
          }
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="absolute bottom-full left-0 z-50 mb-1 max-h-[400px] min-w-[268px] overflow-y-auto rounded-xl border border-border-light bg-bg-secondary shadow-2xl"
        >
          {visibleGroups.length === 0 && (
            <div className="px-3 py-4 text-sm text-text-muted text-center">
              No providers enabled. Enable a provider in Settings.
            </div>
          )}
          {visibleGroups.map((group) => (
            <div key={group.provider}>
              <div className="sticky top-0 bg-bg-secondary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                {group.displayName}
              </div>
              {group.models.map((model) => {
                const modelFlatIndex = flatIndexMap.get(model.id) ?? -1
                const available = isModelAvailable(model)
                return (
                  <button
                    type="button"
                    id={`model-option-${model.id}`}
                    key={model.id}
                    role="option"
                    aria-selected={model.id === value}
                    aria-disabled={!available}
                    onClick={() => {
                      if (available) {
                        onChange(model.id)
                        setIsOpen(false)
                      }
                    }}
                    disabled={!available}
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors',
                      available
                        ? 'text-text-primary hover:bg-bg-hover cursor-pointer'
                        : 'text-text-muted cursor-not-allowed',
                      model.id === value && 'bg-bg-hover',
                      modelFlatIndex === focusedIndex && 'ring-1 ring-inset ring-border-light',
                    )}
                  >
                    <span className="truncate">{model.name}</span>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {!available && <span className="text-xs text-text-muted">No API key</span>}
                      {model.id === value && <Check className="h-3.5 w-3.5 text-accent" />}
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
