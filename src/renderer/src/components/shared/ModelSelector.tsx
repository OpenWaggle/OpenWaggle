import type { ModelDisplayInfo, SupportedModelId } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { api } from '@/lib/ipc'

interface ProviderGroup {
  provider: string
  displayName: string
  models: ModelDisplayInfo[]
}

interface ModelSelectorProps {
  value: SupportedModelId
  onChange: (model: SupportedModelId) => void
  settings: Settings
  className?: string
}

/** Flatten provider groups into a single ordered list of models for keyboard nav */
function flattenModels(groups: ProviderGroup[]): ModelDisplayInfo[] {
  return groups.flatMap((g) => g.models)
}

export function ModelSelector({
  value,
  onChange,
  settings,
  className,
}: ModelSelectorProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [providerGroups, setProviderGroups] = useState<ProviderGroup[]>([])
  const ref = useRef<HTMLDivElement>(null)

  // Fetch provider models once on mount
  useEffect(() => {
    api.getProviderModels().then(setProviderGroups)
  }, [])

  // Filter to only show enabled providers with API keys (or providers that don't require keys)
  const visibleGroups = providerGroups.filter((group) => {
    const config = settings.providers[group.provider as keyof typeof settings.providers]
    if (!config?.enabled) return false
    return true
  })

  const allModels = flattenModels(visibleGroups)
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

  // Reset focused index when dropdown opens
  useEffect(() => {
    if (isOpen) {
      const currentIndex = allModels.findIndex((m) => m.id === value)
      setFocusedIndex(currentIndex >= 0 ? currentIndex : 0)
    }
  }, [isOpen, value, allModels])

  function isModelAvailable(model: ModelDisplayInfo): boolean {
    const config = settings.providers[model.provider as keyof typeof settings.providers]
    return !!config?.apiKey || model.provider === 'ollama'
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setIsOpen(true)
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

  // Track a running flat index for keyboard focus across groups
  let flatIndex = 0

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="no-drag flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
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
          className="absolute top-full left-0 mt-1 z-50 min-w-[260px] max-h-[400px] overflow-y-auto rounded-lg border border-border bg-bg-secondary shadow-xl"
        >
          {visibleGroups.map((group) => {
            const groupItems = group.models.map((model) => {
              const currentFlatIndex = flatIndex++
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
                    currentFlatIndex === focusedIndex && 'ring-1 ring-inset ring-accent/50',
                  )}
                >
                  <span className="truncate">{model.name}</span>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {!available && <span className="text-xs text-text-muted">No API key</span>}
                    {model.id === value && <Check className="h-3.5 w-3.5 text-accent" />}
                  </div>
                </button>
              )
            })

            return (
              <div key={group.provider}>
                <div className="px-3 py-1.5 text-xs font-medium text-text-muted uppercase tracking-wider sticky top-0 bg-bg-secondary">
                  {group.displayName}
                </div>
                {groupItems}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
