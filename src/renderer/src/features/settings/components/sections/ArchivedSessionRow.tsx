import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { RotateCcw, Trash2 } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { formatRelativeTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'

interface ArchivedSessionRowProps {
  readonly session: SessionSummary
  readonly onRestore: (id: SessionId) => void
  readonly onDelete: (id: SessionId) => void
}

export function ArchivedSessionRow({ session, onRestore, onDelete }: ArchivedSessionRowProps) {
  return (
    <div className={cn('group flex items-center gap-3 rounded-md border border-border px-3 py-2')}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-text-secondary">{session.title}</p>
        <p className="text-[11px] text-text-muted">
          {session.messageCount} messages · {formatRelativeTime(session.updatedAt)}
        </p>
      </div>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onRestore(session.id)}
        className="shrink-0 rounded-md px-2 py-1 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
        title="Restore session"
      >
        <RotateCcw className="size-3.5" />
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onDelete(session.id)}
        className="shrink-0 rounded-md px-2 py-1 text-[12px] text-text-muted transition-colors hover:bg-bg-hover hover:text-error"
        title="Delete permanently"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
