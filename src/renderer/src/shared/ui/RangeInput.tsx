import type { InputHTMLAttributes, Ref } from 'react'
import { cn } from '@/shared/lib/cn'

interface RangeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  readonly ref?: Ref<HTMLInputElement>
}

const RANGE_INPUT_CLASS = 'accent-accent'

export function RangeInput({ ref, className, ...props }: RangeInputProps) {
  return <input ref={ref} type="range" className={cn(RANGE_INPUT_CLASS, className)} {...props} />
}
