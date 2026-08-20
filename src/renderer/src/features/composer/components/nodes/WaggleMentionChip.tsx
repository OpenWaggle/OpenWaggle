import { Waypoints } from 'lucide-react'
import { cn } from '@/shared/lib/cn'

interface WaggleMentionChipProps {
  readonly presetName: string
}

export function WaggleMentionChip({ presetName }: WaggleMentionChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border border-amber-500/30',
        'bg-amber-500/10 px-1.5 py-0.5 text-[13px] text-amber-200',
        'cursor-default select-none',
      )}
      title={`Waggle preset: ${presetName}`}
    >
      <Waypoints className="size-3 shrink-0" />
      <span className="max-w-[200px] truncate">{presetName}</span>
    </span>
  )
}
