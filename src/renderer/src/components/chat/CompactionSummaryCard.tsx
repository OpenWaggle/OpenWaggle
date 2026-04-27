import { Archive, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { formatTokens } from '@/lib/format-tokens'
import { StreamingText } from './StreamingText'

interface CompactionSummaryCardProps {
  readonly summary: string
  readonly tokensBefore: number
}

export function CompactionSummaryCard({ summary, tokensBefore }: CompactionSummaryCardProps) {
  const [expanded, setExpanded] = useState(false)
  const tokenLabel = formatTokens(tokensBefore)

  return (
    <section className="rounded-xl border border-border-light bg-bg-secondary/80 p-3 text-text-secondary shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start gap-2 text-left"
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse compaction summary' : 'Expand compaction summary'}
      >
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Archive className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-text-secondary">Compaction</span>
          <span className="block text-[12px] text-text-tertiary">
            Compacted from {tokenLabel} tokens
          </span>
        </span>
        <span className="mt-0.5 text-text-tertiary">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {expanded ? (
        <div className={cn('mt-3 border-t border-border pt-3 text-[13px] text-text-secondary')}>
          <StreamingText text={summary} />
        </div>
      ) : null}
    </section>
  )
}
