import type { CompactionEventData } from '@shared/types/context'
import { AlertTriangle, Shrink } from 'lucide-react'
import { formatTokens } from '@/lib/format-tokens'

interface CompactionEventRowProps {
  readonly data: CompactionEventData
}

export function CompactionEventRow({ data }: CompactionEventRowProps) {
  const label = data.trigger === 'manual' ? 'Context compacted manually' : 'Context compacted'

  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-2.5">
      <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-bg-secondary px-3 py-1.5 text-[11px] text-text-muted">
        <Shrink className="h-3 w-3 shrink-0 text-text-muted" />
        <span>
          {label}
          {data.metrics && (
            <span className="font-mono tabular-nums">
              {' — '}
              {data.metrics.messagesSummarized} msgs · {formatTokens(data.metrics.tokensBefore)} →{' '}
              {formatTokens(data.metrics.tokensAfter)}
            </span>
          )}
        </span>
      </div>
      {data.pinnedContentSummarized && (
        <div className="flex items-center gap-1.5 rounded-lg border border-warning/20 bg-warning/5 px-3 py-1 text-[11px] text-warning">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Pinned content was summarized due to extreme context pressure
        </div>
      )}
    </div>
  )
}
