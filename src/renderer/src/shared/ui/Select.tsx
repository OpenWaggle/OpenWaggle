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
  'border bg-bg-secondary text-text-secondary outline-none transition-[border-color,box-shadow] focus:border-accent/50 focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]'

const SELECT_SIZE_CLASS = {
  // Chip size, matching BranchPickerTrigger so selects can sit in a control row.
  xs: 'h-6 rounded-[5px] border-border px-1.5 text-[12px]',
  sm: 'h-8 rounded-lg border-input-card-border px-2.5 text-[13px]',
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
