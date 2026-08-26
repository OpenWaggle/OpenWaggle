import type { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { RotateCcw } from 'lucide-react'
import { formatRelativeTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'

interface ArchivedBranchSessionProps {
  readonly session: SessionSummary
  readonly onRestoreBranch: (sessionId: SessionId, branchId: SessionBranchId) => void
}

export function ArchivedBranchSession({ session, onRestoreBranch }: ArchivedBranchSessionProps) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="mb-2 min-w-0">
        <p className="truncate text-xs text-text-secondary">{session.title}</p>
        <p className="text-xs text-text-muted">Updated {formatRelativeTime(session.updatedAt)}</p>
      </div>
      <div className="space-y-1">
        {(session.branches ?? []).map((branch) => (
          <div
            key={String(branch.id)}
            className="flex items-center gap-3 rounded-md bg-bg-secondary px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-text-secondary">{branch.name}</p>
              <p className="text-xs text-text-muted">
                Branch · {formatRelativeTime(branch.updatedAt)}
              </p>
            </div>
            <Button
              variant="unstyled"
              type="button"
              onClick={() => onRestoreBranch(session.id, branch.id)}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              title="Restore branch"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
