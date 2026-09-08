import { TIME_UNIT } from '@shared/constants/time'
import { Square } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Spinner'

export type CompactionStatusState = {
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

export function CompactionStatusStrip({ state, onCancel }: CompactionStatusStripProps) {
  const retryDelaySeconds = Math.ceil(state.delayMs / TIME_UNIT.MILLISECONDS_PER_SECOND)
  const label = `Retrying (${String(state.attempt)}/${String(state.maxAttempts)}) in ${String(retryDelaySeconds)}s…`

  return (
    <div className="mx-3.5 flex items-center gap-2 rounded-t-3xl border-x border-t border-border-light bg-bg-secondary px-2.5 pt-2 pb-1.5 text-text-tertiary">
      <Spinner size="sm" className="text-warning" />
      <span className="min-w-0 flex-1 text-xs font-medium">{label}</span>
      <Button
        variant="unstyled"
        type="button"
        onClick={onCancel}
        className="flex h-6 items-center gap-1 rounded-md border border-error/30 bg-error/10 px-2 text-xs font-semibold text-error-text transition-colors hover:bg-error/18"
        aria-label="Cancel retry"
        title="Cancel retry"
      >
        <Square className="size-3" />
        <span>Stop</span>
      </Button>
    </div>
  )
}
