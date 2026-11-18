import type { Ref, SelectHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/cn'

type SelectSize = 'xs' | 'sm' | 'md'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly ref?: Ref<HTMLSelectElement>
  readonly selectSize?: SelectSize
}

/**
 * Radius and border colour live in the size map, not the base class. `cn` is a
 * plain join (no Tailwind conflict resolution), so emitting them in the base
 * would make them impossible to override per size — two competing utilities
 * would both survive and stylesheet order would decide the winner.
 */
const SELECT_BASE_CLASS =
  // No focus ring or glow, per the app-wide decision that focus draws nothing.
  'border bg-bg-secondary text-text-secondary outline-none transition-[border-color]'

const SELECT_SIZE_CLASS = {
  // Chip size, matching BranchPickerTrigger so selects can sit in a control row.
  xs: 'h-6 rounded-md border-border px-1.5 text-xs',
  sm: 'h-8 rounded-lg border-input-card-border px-2.5 text-sm',
  md: 'rounded-lg border-input-card-border px-3 py-2 text-sm',
}

export function Select({ ref, selectSize = 'sm', className, children, ...props }: SelectProps) {
  return (
    <select
      ref={ref}
      className={cn(SELECT_BASE_CLASS, SELECT_SIZE_CLASS[selectSize], className)}
      {...props}
    >
      {children}
    </select>
  )
}
