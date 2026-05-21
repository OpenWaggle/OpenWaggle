import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/shared/lib/cn'

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'danger'
  | 'ghost'
  | 'subtle'
  | 'row'
  | 'link'
  | 'unstyled'

type ButtonSize = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'icon-xs' | 'icon-sm' | 'icon-md' | 'icon-lg'
type ButtonRadius = 'none' | 'sm' | 'md' | 'lg' | 'full'
type ButtonAlign = 'center' | 'start' | 'between'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly ref?: Ref<HTMLButtonElement>
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly radius?: ButtonRadius
  readonly align?: ButtonAlign
  readonly fullWidth?: boolean
  readonly leftIcon?: ReactNode
  readonly rightIcon?: ReactNode
}

const BUTTON_BASE_CLASS =
  'inline-flex shrink-0 items-center gap-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-50'
const BUTTON_UNSTYLED_BASE_CLASS = 'disabled:cursor-not-allowed disabled:opacity-50'

const BUTTON_VARIANT_CLASS = {
  primary: 'bg-gradient-to-b from-accent to-accent-dim text-bg hover:brightness-110',
  secondary:
    'border border-border bg-bg text-text-secondary hover:bg-bg-hover hover:text-text-primary',
  accent: 'border border-accent/30 bg-accent/5 text-accent hover:bg-accent/10',
  danger: 'border border-error/30 bg-error/10 text-error hover:bg-error/18',
  ghost: 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary',
  subtle: 'bg-bg-hover text-text-tertiary hover:text-text-secondary',
  row: 'w-full text-left text-text-secondary hover:bg-bg-hover',
  link: 'font-medium text-link-yellow underline-offset-2 hover:underline',
  unstyled: '',
}

const BUTTON_SIZE_CLASS = {
  none: '',
  xs: 'px-2 py-1 text-[11px]',
  sm: 'px-2.5 py-1.5 text-[12px]',
  md: 'px-3 py-2 text-[13px]',
  lg: 'px-7 py-3.5 text-[15px]',
  'icon-xs': 'size-5 p-0',
  'icon-sm': 'size-6 p-0',
  'icon-md': 'size-8 p-0',
  'icon-lg': 'size-9 p-0',
}

const BUTTON_RADIUS_CLASS = {
  none: '',
  sm: 'rounded',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
}

const BUTTON_ALIGN_CLASS = {
  center: 'justify-center',
  start: 'justify-start',
  between: 'justify-between',
}

function defaultSizeForVariant(variant: ButtonVariant) {
  return variant === 'unstyled' ? 'none' : 'sm'
}

function defaultRadiusForVariant(variant: ButtonVariant) {
  return variant === 'unstyled' ? 'none' : 'md'
}

function defaultAlignForVariant(variant: ButtonVariant) {
  return variant === 'row' ? 'start' : 'center'
}

/**
 * Shared renderer button primitive.
 *
 * Every app-level button should flow through this component so disabled,
 * focus, spacing, and tone conventions stay consistent. `unstyled` exists
 * for specialized surfaces that need exact layout control, but still keeps
 * button semantics centralized.
 */
export function Button({
  ref,
  variant = 'secondary',
  size,
  radius,
  align,
  fullWidth = false,
  type = 'button',
  className,
  leftIcon,
  rightIcon,
  children,
  ...props
}: ButtonProps) {
  const resolvedSize = size ?? defaultSizeForVariant(variant)
  const resolvedRadius = radius ?? defaultRadiusForVariant(variant)
  const resolvedAlign = align ?? defaultAlignForVariant(variant)
  const isUnstyled = variant === 'unstyled'

  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        isUnstyled ? BUTTON_UNSTYLED_BASE_CLASS : BUTTON_BASE_CLASS,
        BUTTON_VARIANT_CLASS[variant],
        BUTTON_SIZE_CLASS[resolvedSize],
        BUTTON_RADIUS_CLASS[resolvedRadius],
        !isUnstyled && BUTTON_ALIGN_CLASS[resolvedAlign],
        fullWidth && 'w-full',
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
