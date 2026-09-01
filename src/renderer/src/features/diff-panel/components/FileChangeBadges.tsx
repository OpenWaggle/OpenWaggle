import type { FileChangeStats, FileChangeStatus } from '@/features/diff-panel/lib/navigator-tree'
import { cn } from '@/shared/lib/cn'

const STATUS_GLYPH: Record<FileChangeStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
}

const STATUS_CLASS: Record<FileChangeStatus, string> = {
  added: 'text-diff-add-mark',
  modified: 'text-accent',
  deleted: 'text-diff-remove-text',
}

export function FileChangeBadges({ stats }: { readonly stats: FileChangeStats }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1 pl-1">
      {stats.additions > 0 ? (
        <span className="text-xs text-diff-add-mark">+{String(stats.additions)}</span>
      ) : null}
      {stats.deletions > 0 ? (
        <span className="text-xs text-diff-remove-text">-{String(stats.deletions)}</span>
      ) : null}
      <span
        role="img"
        aria-label={stats.status}
        title={stats.status}
        className={cn('w-2 text-center text-xs font-semibold', STATUS_CLASS[stats.status])}
      >
        {STATUS_GLYPH[stats.status]}
      </span>
    </span>
  )
}
