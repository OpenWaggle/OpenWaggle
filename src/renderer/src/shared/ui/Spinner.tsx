import { cn } from '@/shared/lib/cn'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = {
  sm: 'size-3 border-[1.5px]',
  md: 'size-4 border-2',
  lg: 'size-6 border-2',
} as const

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <output
      aria-label="Loading"
      className={cn(
        'block animate-spin rounded-full border-current border-t-transparent opacity-70',
        sizes[size],
        className,
      )}
    />
  )
}
