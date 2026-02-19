import { cn } from '@/lib/cn'

type BadgeVariant = 'default' | 'success' | 'error' | 'info' | 'warning'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-bg-tertiary text-text-secondary',
  success: 'bg-success/15 text-success',
  error: 'bg-error/15 text-error',
  info: 'bg-info/15 text-info',
  warning: 'bg-accent/15 text-accent',
}

export function Badge({ children, variant = 'default', className }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[13px] font-medium',
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
