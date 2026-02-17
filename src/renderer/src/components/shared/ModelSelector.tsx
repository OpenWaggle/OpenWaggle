import type { SupportedModelId } from '@shared/types/llm'
import { MODEL_DISPLAY_INFO, type ModelDisplayInfo } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

interface ModelSelectorProps {
  value: SupportedModelId
  onChange: (model: SupportedModelId) => void
  settings: Settings
  className?: string
}

export function ModelSelector({
  value,
  onChange,
  settings,
  className,
}: ModelSelectorProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedModel = MODEL_DISPLAY_INFO.find((m) => m.id === value)

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
      const currentIndex = MODEL_DISPLAY_INFO.findIndex((m) => m.id === value)
      setFocusedIndex(currentIndex >= 0 ? currentIndex : 0)
    }
  }, [isOpen, value])

  function isModelAvailable(model: ModelDisplayInfo): boolean {
    return !!settings.providers[model.provider]?.apiKey
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
        setFocusedIndex((prev) => (prev + 1) % MODEL_DISPLAY_INFO.length)
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        setFocusedIndex(
          (prev) => (prev - 1 + MODEL_DISPLAY_INFO.length) % MODEL_DISPLAY_INFO.length,
        )
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const model = MODEL_DISPLAY_INFO[focusedIndex]
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
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="no-drag flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
      >
        <span className="truncate max-w-[180px]">{selectedModel?.name ?? 'Select model'}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>

      {isOpen && (
        <div
          ref={listRef}
          role="listbox"
          aria-activedescendant={
            focusedIndex >= 0 ? `model-option-${MODEL_DISPLAY_INFO[focusedIndex]?.id}` : undefined
          }
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="absolute top-full left-0 mt-1 z-50 min-w-[220px] rounded-lg border border-border bg-bg-secondary shadow-xl"
        >
          {MODEL_DISPLAY_INFO.map((model, index) => {
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
                  'flex w-full items-center justify-between px-3 py-2 text-sm transition-colors',
                  available
                    ? 'text-text-primary hover:bg-bg-hover cursor-pointer'
                    : 'text-text-muted cursor-not-allowed',
                  model.id === value && 'bg-bg-hover',
                  index === focusedIndex && 'ring-1 ring-inset ring-accent/50',
                )}
              >
                <div className="flex flex-col items-start">
                  <span>{model.name}</span>
                  {!available && <span className="text-xs text-text-muted">No API key</span>}
                </div>
                <span className="text-xs text-text-muted capitalize">{model.provider}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
