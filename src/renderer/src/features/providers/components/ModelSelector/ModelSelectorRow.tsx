import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { ProviderModelIcon } from './provider-icon'
import type { FlatModel } from './types'

interface ModelSelectorRowProps {
  readonly model: FlatModel
  readonly isSelected: boolean
  readonly onSelect: (model: FlatModel) => void
}

export function ModelSelectorRow({ model, isSelected, onSelect }: ModelSelectorRowProps) {
  function handleSelect() {
    onSelect(model)
  }

  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={isSelected}
      aria-label={model.name}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleSelect()
        }
      }}
      title={model.id}
      className={cn(
        'group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        'cursor-pointer text-text-primary hover:bg-bg-hover',
        isSelected && 'bg-bg-active',
      )}
    >
      <ProviderModelIcon provider={model.provider} className="size-4 shrink-0 flex-none" />
      <div className="min-w-0 flex-1 truncate text-sm font-medium">
        {model.name}
        <span className="ml-1.5 text-xs font-normal text-text-tertiary">{model.providerName}</span>
      </div>
      {model.contextWindowLabel && (
        <span className="shrink-0 text-xs text-text-tertiary">{model.contextWindowLabel}</span>
      )}
      {isSelected && <Check className="size-3 shrink-0 text-accent" />}
    </div>
  )
}
