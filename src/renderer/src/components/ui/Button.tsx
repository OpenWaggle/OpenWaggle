import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'ghost'
type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly ref?: Ref<HTMLButtonElement>
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly leftIcon?: ReactNode
  readonly rightIcon?: ReactNode
}

const BUTTON_BASE_CLASS =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-black hover:bg-accent/90',
  secondary:
    'border border-border bg-bg text-text-secondary hover:border-border-light hover:text-text-primary',
  accent: 'border border-accent/30 bg-accent/5 text-accent hover:bg-accent/10',
  ghost: 'border border-border bg-bg-hover text-text-secondary hover:text-text-primary',
}

const BUTTON_SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-[12px]',
  md: 'px-3 py-2 text-[13px]',
}

export function Button({
  ref,
  variant = 'secondary',
  size = 'sm',
  type = 'button',
  className,
  leftIcon,
  rightIcon,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        BUTTON_BASE_CLASS,
        BUTTON_VARIANT_CLASS[variant],
        BUTTON_SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  )
}
