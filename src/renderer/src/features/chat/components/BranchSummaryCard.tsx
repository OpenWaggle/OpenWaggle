import { GitBranch } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { StreamingText } from './StreamingText'

interface BranchSummaryCardProps {
  readonly id: string
  readonly summary: string
  readonly onBranchFromMessage?: (messageId: string) => void
}

export function BranchSummaryCard({ id, summary, onBranchFromMessage }: BranchSummaryCardProps) {
  return (
    <section className="group/branch-summary rounded-xl border border-border-light bg-bg-secondary/80 p-3 text-text-secondary shadow-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <GitBranch className="size-3" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="block text-[12px] font-semibold text-text-secondary">
              Branch summary
            </span>
            {onBranchFromMessage ? (
              <Button
                variant="unstyled"
                type="button"
                title="Branch from summary"
                onClick={() => onBranchFromMessage(id)}
                className="opacity-0 text-text-muted transition-opacity hover:text-text-secondary group-hover/branch-summary:opacity-100 focus:opacity-100"
              >
                <GitBranch className="size-3.5" />
              </Button>
            ) : null}
          </div>
          <div className="mt-2 text-[13px] text-text-secondary">
            <StreamingText text={summary} />
          </div>
        </div>
      </div>
    </section>
  )
}
