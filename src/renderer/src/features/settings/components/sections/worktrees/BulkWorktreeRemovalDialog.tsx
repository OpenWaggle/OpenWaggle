import type { WorktreeInventoryEntry } from '@shared/types/worktree-inventory'
import { useId } from 'react'
import { formatBytes, projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import type { WorktreeSpaceByPath } from './use-worktree-inventory'
import { worktreeTitle } from './worktree-inventory-format'

/**
 * Confirms removing every worktree that is safe to remove. Each one is checked again by the Host
 * as it is removed, so one that changed since the list was read is kept and reported.
 */
export function BulkWorktreeRemovalDialog(props: {
  readonly entries: readonly WorktreeInventoryEntry[]
  readonly space: WorktreeSpaceByPath
  readonly onConfirm: () => void
  readonly onClose: () => void
}) {
  const titleId = useId()
  const total = props.entries.reduce((sum, entry) => sum + (props.space.get(entry.path) ?? 0), 0)
  const count = props.entries.length
  return (
    <ModalDialog labelledBy={titleId} onClose={props.onClose}>
      <div className="flex flex-col p-5">
        <h2 id={titleId} className="text-sm font-semibold text-text-primary">
          Remove {String(count)} {count === 1 ? 'worktree' : 'worktrees'} and free about{' '}
          {formatBytes(total)}?
        </h2>
        <p className="mt-2 text-xs leading-5 text-text-secondary">
          None of them has uncommitted changes or commits that are not on a remote, and no open
          Session uses them. Their folders are deleted, including ignored files such as .env and
          node_modules. Branches are kept, and unarchiving a Session recreates its worktree.
        </p>
        <ul
          aria-label="Worktrees to remove"
          className="mt-3 max-h-80 overflow-y-auto rounded-md border border-border"
        >
          {props.entries.map((entry) => {
            const bytes = props.space.get(entry.path)
            return (
              <li
                key={entry.path}
                title={entry.path}
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs last:border-b-0"
              >
                <span className="min-w-0 truncate text-text-primary">
                  {worktreeTitle(entry)}
                  <span className="text-text-tertiary"> · {projectName(entry.projectPath)}</span>
                </span>
                <span className="shrink-0 text-text-tertiary tabular-nums">
                  {typeof bytes === 'number' ? formatBytes(bytes) : '—'}
                </span>
              </li>
            )
          })}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={props.onConfirm}>
            Remove {String(count)} {count === 1 ? 'worktree' : 'worktrees'}
          </Button>
        </div>
      </div>
    </ModalDialog>
  )
}
