import type { Ref, SelectHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/cn'

type SelectSize = 'sm' | 'md'

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  readonly ref?: Ref<HTMLSelectElement>
  readonly selectSize?: SelectSize
}

const SELECT_BASE_CLASS =
  'rounded-lg border border-input-card-border bg-bg-secondary text-text-secondary outline-none transition-[border-color,box-shadow] focus:border-accent/50 focus:shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]'

const SELECT_SIZE_CLASS = {
  sm: 'h-8 px-2.5 text-[13px]',
  md: 'px-3 py-2 text-sm',
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
