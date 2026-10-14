import { Brain, Check, type LucideIcon, PlugZap, Ruler } from 'lucide-react'
import type { ModelFilterId } from '@/features/settings/lib/available-models-filter'
import { MODEL_FILTER_IDS } from '@/features/settings/lib/available-models-filter'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

const FILTER_META: Readonly<Record<ModelFilterId, { label: string; icon: LucideIcon }>> = {
  selected: { label: 'Selected', icon: Check },
  ready: { label: 'Ready to use', icon: PlugZap },
  reasoning: { label: 'Reasoning', icon: Brain },
  'long-context': { label: '1M+ context', icon: Ruler },
}

interface ModelFilterChipsProps {
  readonly active: ReadonlySet<ModelFilterId>
  readonly counts: Readonly<Record<ModelFilterId, number>>
  readonly onToggle: (filter: ModelFilterId) => void
}

export function ModelFilterChips({ active, counts, onToggle }: ModelFilterChipsProps) {
  return (
    <fieldset aria-label="Filter models" className="flex flex-wrap gap-1.5">
      {MODEL_FILTER_IDS.map((filter) => {
        const { label, icon: Icon } = FILTER_META[filter]
        const isActive = active.has(filter)
        return (
          <Button
            key={filter}
            variant="unstyled"
            type="button"
            aria-pressed={isActive}
            onClick={() => onToggle(filter)}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
              isActive
                ? 'border-accent/60 bg-accent/15 text-accent'
                : 'border-border-light bg-bg text-text-secondary hover:bg-bg-hover hover:text-text-primary',
            )}
          >
            <Icon className="size-3" aria-hidden="true" />
            {label}
            <span className="tabular-nums opacity-80">{counts[filter]}</span>
          </Button>
        )
      })}
    </fieldset>
  )
}
