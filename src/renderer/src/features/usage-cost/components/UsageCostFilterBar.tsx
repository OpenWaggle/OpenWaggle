import type { UsageCostQuery } from '@shared/types/usage-cost'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

const RANGE_OPTIONS: readonly {
  readonly value: UsageCostQuery['preset']
  readonly label: string
}[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
]

const ORIGIN_OPTIONS: readonly {
  readonly value: UsageCostQuery['origin']
  readonly label: string
}[] = [
  { value: 'all', label: 'All' },
  { value: 'openwaggle', label: 'OpenWaggle' },
  { value: 'other-pi-clients', label: 'pi CLI & other' },
]

interface UsageCostFilterBarProps {
  readonly query: UsageCostQuery
  readonly onRange: (preset: UsageCostQuery['preset']) => void
  readonly onOrigin: (origin: UsageCostQuery['origin']) => void
}

function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  readonly ariaLabel: string
  readonly options: readonly { readonly value: T; readonly label: string }[]
  readonly value: T
  readonly onChange: (value: T) => void
}) {
  return (
    <fieldset
      aria-label={ariaLabel}
      className="flex shrink-0 rounded-md border border-border bg-bg-secondary p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <Button
            key={option.value}
            type="button"
            aria-pressed={active}
            size="xs"
            variant="ghost"
            className={cn(
              'h-7 px-2.5 text-xs',
              active ? 'bg-bg-active text-text-primary' : 'text-text-tertiary',
            )}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        )
      })}
    </fieldset>
  )
}

export function UsageCostFilterBar({ query, onRange, onOrigin }: UsageCostFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        ariaLabel="Date range"
        options={RANGE_OPTIONS}
        value={query.preset}
        onChange={onRange}
      />
      <SegmentedControl
        ariaLabel="Session origin"
        options={ORIGIN_OPTIONS}
        value={query.origin}
        onChange={onOrigin}
      />
    </div>
  )
}
