import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { resolveIcon, resolveIconColor } from './provider-icon'
import type { FlatModel } from './types'

const COMPAT_INDICATOR: Record<string, { color: string; label: string }> = {
  'tight-fit': { color: 'text-warning', label: 'Tight' },
  'would-compact': { color: 'text-warning', label: 'Compact' },
  blocked: { color: 'text-error', label: 'Blocked' },
}

interface ModelSelectorRowProps {
  readonly model: FlatModel
  readonly isSelected: boolean
  readonly onSelect: (model: FlatModel) => void
}

export function ModelSelectorRow({ model, isSelected, onSelect }: ModelSelectorRowProps) {
  const Icon = resolveIcon(model.provider, model.authMethod)
  const iconColor = resolveIconColor(model.provider, model.authMethod)
  const isBlocked = model.compatibility === 'blocked'
  const compatInfo = model.compatibility ? COMPAT_INDICATOR[model.compatibility] : undefined

  function handleSelect() {
    if (isBlocked) return
    onSelect(model)
  }

  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={isSelected}
      aria-disabled={isBlocked}
      aria-label={model.name}
      onClick={handleSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          handleSelect()
        }
      }}
      title={
        isBlocked
          ? "This conversation exceeds this model's context window. Compact first."
          : model.id
      }
      className={cn(
        'group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors',
        isBlocked
          ? 'cursor-not-allowed opacity-50 text-[#e7e9ee]'
          : 'cursor-pointer text-[#e7e9ee] hover:bg-[#171b21]',
        isSelected && 'bg-[#1a1f28]',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 flex-none" style={{ color: iconColor }} />
      <div className="min-w-0 flex-1 truncate text-[13px] font-medium">{model.name}</div>
      {model.contextWindowLabel && (
        <span className="shrink-0 text-[10px] text-text-tertiary">{model.contextWindowLabel}</span>
      )}
      {compatInfo && (
        <span className={cn('shrink-0 text-[10px] font-medium', compatInfo.color)}>
          {compatInfo.label}
        </span>
      )}
      {isSelected && <Check className="h-3 w-3 shrink-0 text-accent" />}
    </div>
  )
}
