import { cn } from '@/shared/lib/cn'

interface SessionTreeBadgeProps {
  readonly label: string
  readonly tone: 'accent' | 'muted' | 'warning'
}

export function SessionTreeBadge({ label, tone }: SessionTreeBadgeProps) {
  return (
    <span
      className={cn(
        'rounded border px-1 py-0.5 text-[10px] leading-none',
        tone === 'accent' && 'border-accent/40 bg-accent/10 text-accent',
        tone === 'muted' && 'border-border bg-bg-secondary text-text-muted',
        tone === 'warning' && 'border-warning/40 bg-warning/10 text-warning',
      )}
    >
      {label}
    </span>
  )
}
