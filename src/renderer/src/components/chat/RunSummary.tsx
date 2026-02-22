import type { CompletedPhase } from '@/hooks/useStreamingPhase'
import { formatElapsed } from '@/hooks/useStreamingPhase'
import { cn } from '@/lib/cn'

interface RunSummaryProps {
  phases: readonly CompletedPhase[]
  totalMs: number
}

export function RunSummary({ phases, totalMs }: RunSummaryProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 py-3">
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <div className="h-px flex-1 bg-border" />
        <span>Completed in {formatElapsed(totalMs)}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-0.5 px-4 pt-1">
        {phases.map((phase, i) => (
          <div
            key={`${phase.label}-${String(i)}`}
            className="flex items-center justify-between text-xs"
          >
            <span className="text-text-tertiary">{phase.label}</span>
            <span className={cn('text-text-muted tabular-nums')}>
              {formatElapsed(phase.durationMs)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
