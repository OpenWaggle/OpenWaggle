import type { Ref, TextareaHTMLAttributes } from 'react'
import { cn } from '@/shared/lib/cn'

type TextareaVariant = 'default' | 'mono'
type TextareaResize = 'none' | 'vertical' | 'both'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly ref?: Ref<HTMLTextAreaElement>
  readonly variant?: TextareaVariant
  readonly resize?: TextareaResize
}

const TEXTAREA_BASE_CLASS =
  'block w-full rounded-lg border border-input-card-border bg-bg px-3 py-2 text-text-secondary outline-none transition-colors [scrollbar-width:none] [&::-webkit-scrollbar]:hidden placeholder:text-text-muted focus:border-border-light'

const TEXTAREA_VARIANT_CLASS: Record<TextareaVariant, string> = {
  default: 'text-sm',
  mono: 'font-mono text-xs leading-5',
}

const TEXTAREA_RESIZE_CLASS: Record<TextareaResize, string> = {
  none: 'resize-none',
  vertical: 'resize-y',
  both: 'resize',
}

export function Textarea({
  ref,
  variant = 'default',
  resize = 'vertical',
  className,
  ...props
}: TextareaProps) {
  return (
    <textarea
      ref={ref}
      className={cn(
        TEXTAREA_BASE_CLASS,
        TEXTAREA_VARIANT_CLASS[variant],
        TEXTAREA_RESIZE_CLASS[resize],
        className,
      )}
      {...props}
    />
  )
}
