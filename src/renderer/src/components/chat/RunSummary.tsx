import { MILLISECONDS_PER_SECOND } from '@shared/constants/constants'
import type { CompletedPhase } from '@/hooks/useStreamingPhase'
import { formatElapsed } from '@/hooks/useStreamingPhase'
import { cn } from '@/lib/cn'

interface RunSummaryProps {
  phases: readonly CompletedPhase[]
  totalMs: number
}

function mergePhasesByLabel(phases: readonly CompletedPhase[]): CompletedPhase[] {
  const merged = new Map<string, number>()
  const order: string[] = []
  const seen = new Set<string>()
  for (const p of phases) {
    merged.set(p.label, (merged.get(p.label) ?? 0) + p.durationMs)
    if (!seen.has(p.label)) {
      seen.add(p.label)
      order.push(p.label)
    }
  }
  return order.map((label) => ({ label, durationMs: merged.get(label) ?? 0 }))
}

export function RunSummary({ phases, totalMs }: RunSummaryProps) {
  const visiblePhases = mergePhasesByLabel(phases).filter(
    (p) => p.durationMs >= MILLISECONDS_PER_SECOND,
  )

  return (
    <div className="flex flex-col gap-1 py-3">
      <div className="flex items-center gap-3 text-xs text-text-muted">
        <div className="h-px flex-1 bg-border" />
        <span>Completed in {formatElapsed(totalMs)}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      {visiblePhases.length > 0 && (
        <div className="flex flex-col gap-0.5 px-4 pt-1">
          {visiblePhases.map((phase, i) => (
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
      )}
    </div>
  )
}
