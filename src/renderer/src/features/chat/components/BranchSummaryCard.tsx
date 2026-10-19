import { GitBranch } from 'lucide-react'
import { StreamingText } from './StreamingText'

interface BranchSummaryCardProps {
  readonly id: string
  readonly summary: string
}

/**
 * A summary of a branch the conversation left. It is not a place to branch from: that is the Session
 * tree's, which reaches every point of the history.
 */
export function BranchSummaryCard({ id, summary }: BranchSummaryCardProps) {
  return (
    <section
      data-branch-summary-id={id}
      className="rounded-xl border border-border-light bg-bg-secondary/80 p-3 text-text-secondary shadow-sm"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <GitBranch className="size-3" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-text-secondary">Branch summary</span>
          <div className="mt-2 text-sm text-text-secondary">
            <StreamingText text={summary} />
          </div>
        </div>
      </div>
    </section>
  )
}
