import type { RunMode } from '@shared/types/background-run'
import type { SessionBranchId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import { AlertTriangle, X } from 'lucide-react'
import { formatRelativeTime } from '@/lib/format'

interface InterruptedRunNoticeProps {
  readonly runId: string
  readonly branchId: SessionBranchId
  readonly runMode: RunMode
  readonly model: SupportedModelId
  readonly interruptedAt: number
  readonly onDismiss?: (runId: string, branchId: SessionBranchId) => void
}

export function InterruptedRunNotice({
  runId,
  branchId,
  runMode,
  model,
  interruptedAt,
  onDismiss,
}: InterruptedRunNoticeProps) {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-text-secondary">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">Run interrupted</p>
              <p className="mt-1 text-[13px] text-text-tertiary">
                OpenWaggle closed before this {runMode === 'waggle' ? 'Waggle' : 'standard'} run
                finished. The latest Pi session state was restored without auto-resuming.
              </p>
            </div>
            {onDismiss ? (
              <button
                type="button"
                onClick={() => onDismiss(runId, branchId)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
                aria-label="Dismiss interrupted run notice"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-muted">
            <span className="rounded-md bg-bg-hover px-2 py-0.5">{String(model)}</span>
            <span className="rounded-md bg-bg-hover px-2 py-0.5">
              {formatRelativeTime(interruptedAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
