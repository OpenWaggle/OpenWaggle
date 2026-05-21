import type { InputHTMLAttributes, Ref } from 'react'
import { cn } from '@/shared/lib/cn'

type TextInputVariant = 'default' | 'transparent'
type TextInputSize = 'sm' | 'md'

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly ref?: Ref<HTMLInputElement>
  readonly variant?: TextInputVariant
  readonly inputSize?: TextInputSize
  readonly monospace?: boolean
}

const TEXT_INPUT_BASE_CLASS =
  'w-full border text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-accent/50'

const TEXT_INPUT_VARIANT_CLASS = {
  default: 'rounded-md border-border bg-bg',
  transparent: 'border-transparent bg-transparent focus:border-transparent',
}

const TEXT_INPUT_SIZE_CLASS = {
  sm: 'h-8 px-2.5 text-[13px]',
  md: 'px-3 py-2 text-sm',
}

/**
 * Shared text-like input primitive for visible user-editable fields.
 * Hidden/file inputs remain feature-specific because they are behavioral
 * capabilities, not styled UI controls.
 */
export function TextInput({
  ref,
  variant = 'default',
  inputSize = 'md',
  monospace = false,
  className,
  ...props
}: TextInputProps) {
  return (
    <input
      ref={ref}
      className={cn(
        TEXT_INPUT_BASE_CLASS,
        TEXT_INPUT_VARIANT_CLASS[variant],
        TEXT_INPUT_SIZE_CLASS[inputSize],
        monospace && 'font-mono placeholder:font-sans',
        className,
      )}
      {...props}
    />
  )
}
