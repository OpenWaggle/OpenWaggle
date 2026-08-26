import { TIME_UNIT } from '@shared/constants/time'
import { Square } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Spinner'

export type CompactionStatusState =
  | {
      readonly type: 'compacting'
      readonly reason: 'manual' | 'threshold' | 'overflow'
    }
  | {
      readonly type: 'retrying'
      readonly attempt: number
      readonly maxAttempts: number
      readonly delayMs: number
      readonly errorMessage: string
    }

interface CompactionStatusStripProps {
  readonly state: CompactionStatusState
  readonly onCancel: () => void
}

function getCompactionLabel(reason: 'manual' | 'threshold' | 'overflow') {
  if (reason === 'manual') {
    return 'Compacting context…'
  }
  if (reason === 'overflow') {
    return 'Context overflow detected, auto-compacting…'
  }
  return 'Auto-compacting…'
}

export function CompactionStatusStrip({ state, onCancel }: CompactionStatusStripProps) {
  const isRetrying = state.type === 'retrying'
  const retryDelaySeconds = isRetrying
    ? Math.ceil(state.delayMs / TIME_UNIT.MILLISECONDS_PER_SECOND)
    : 0
  const label = isRetrying
    ? `Retrying (${String(state.attempt)}/${String(state.maxAttempts)}) in ${String(retryDelaySeconds)}s…`
    : getCompactionLabel(state.reason)
  const cancelLabel = isRetrying ? 'Cancel retry' : 'Cancel compaction'

  return (
    <div className="mx-3.5 flex items-center gap-2 rounded-t-3xl border-x border-t border-border-light bg-bg-secondary px-2.5 pt-2 pb-1.5 text-text-tertiary">
      <Spinner size="sm" className={isRetrying ? 'text-warning' : 'text-accent'} />
      <span className="min-w-0 flex-1 text-xs font-medium">{label}</span>
      <Button
        variant="unstyled"
        type="button"
        onClick={onCancel}
        className="flex h-6 items-center gap-1 rounded-md border border-error/30 bg-error/10 px-2 text-xs font-semibold text-error-text transition-colors hover:bg-error/18"
        aria-label={cancelLabel}
        title={cancelLabel}
      >
        <Square className="size-3" />
        <span>Stop</span>
      </Button>
    </div>
  )
}
