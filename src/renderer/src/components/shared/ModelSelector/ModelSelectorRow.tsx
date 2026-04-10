import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { resolveIcon, resolveIconColor } from './provider-icon'
import type { FlatModel } from './types'

interface ModelSelectorRowProps {
  readonly model: FlatModel
  readonly isSelected: boolean
  readonly onSelect: (model: FlatModel) => void
}

export function ModelSelectorRow({ model, isSelected, onSelect }: ModelSelectorRowProps) {
  const Icon = resolveIcon(model.provider, model.authMethod)
  const iconColor = resolveIconColor(model.provider, model.authMethod)

  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={isSelected}
      aria-label={model.name}
      onClick={() => onSelect(model)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(model)
        }
      }}
      title={model.id}
      className={cn(
        'group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        'cursor-pointer text-[#e7e9ee] hover:bg-[#171b21]',
        isSelected && 'bg-[#1a1f28]',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 flex-none" style={{ color: iconColor }} />
      <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{model.name}</div>
      {isSelected && <Check className="h-3 w-3 shrink-0 text-accent" />}
    </div>
  )
}
