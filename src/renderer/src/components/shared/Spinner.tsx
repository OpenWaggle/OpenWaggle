import { cn } from '@/lib/cn'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = {
  sm: 'h-3 w-3 border-[1.5px]',
  md: 'h-4 w-4 border-2',
  lg: 'h-6 w-6 border-2',
} as const

export function Spinner({ size = 'md', className }: SpinnerProps): React.JSX.Element {
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
