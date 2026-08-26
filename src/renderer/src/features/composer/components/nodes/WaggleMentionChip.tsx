import { Waypoints } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

interface WaggleMentionChipProps {
  readonly presetName: string
}

export function WaggleMentionChip({ presetName }: WaggleMentionChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border border-accent/30',
        'bg-accent/10 px-1.5 py-0.5 text-sm text-accent',
        'cursor-default select-none',
      )}
      title={`Waggle preset: ${presetName}`}
    >
      <Waypoints className="size-3 shrink-0" />
      <span className="max-w-50 truncate">{presetName}</span>
    </span>
  )
}
