import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/shared/lib/cn'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly ref?: Ref<HTMLInputElement>
  readonly label?: ReactNode
  readonly labelClassName?: string
}

const CHECKBOX_CLASS = 'size-3.5 shrink-0 rounded border-border bg-bg text-accent'

export function Checkbox({ ref, label, labelClassName, className, ...props }: CheckboxProps) {
  if (!label) {
    return <input ref={ref} type="checkbox" className={cn(CHECKBOX_CLASS, className)} {...props} />
  }

  return (
    <label
      className={cn(
        'flex items-center gap-2 text-[13px] text-text-secondary',
        props.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        labelClassName,
      )}
    >
      <input ref={ref} type="checkbox" className={cn(CHECKBOX_CLASS, className)} {...props} />
      {label}
    </label>
  )
}
