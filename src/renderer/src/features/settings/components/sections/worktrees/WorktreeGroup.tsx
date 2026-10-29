import type {
  WorktreeInventoryEntry,
  WorktreeInventoryGroup,
} from '@shared/types/worktree-inventory'
import { ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { formatBytes } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import type { WorktreeSpaceByPath } from './use-worktree-inventory'
import type { WorktreeRemovalRequest } from './use-worktree-removal'
import { WorktreeInventoryRow } from './WorktreeInventoryRow'

const GROUP_COPY: Record<
  WorktreeInventoryGroup,
  { readonly title: string; readonly description: string; readonly open: boolean }
> = {
  safe: {
    title: 'Safe to remove',
    description: 'Every change is committed and on a remote, and no open Session uses them.',
    open: true,
  },
  decide: {
    title: 'Needs a decision',
    description:
      'These hold uncommitted changes or commits not on a remote, were created outside OpenWaggle, are locked, failed their cleanup, or could not be checked.',
    open: true,
  },
  'in-use': {
    title: 'In use',
    description: 'Open Sessions, Runs, terminals or Actions use these worktrees.',
    open: false,
  },
}

/** What every row in the list shares. */
export interface WorktreeRowContext {
  readonly space: WorktreeSpaceByPath
  readonly busyPaths: ReadonlySet<string>
  readonly projectNames: ReadonlyMap<string, string>
  readonly now: number
  readonly onRemove: (request: WorktreeRemovalRequest) => void
  readonly onConfirm: (request: WorktreeRemovalRequest) => void
}

/** One group of worktrees, with its count and size; In use starts collapsed. */
export function WorktreeGroup(props: {
  readonly group: WorktreeInventoryGroup
  readonly entries: readonly WorktreeInventoryEntry[]
  readonly context: WorktreeRowContext
}) {
  const copy = GROUP_COPY[props.group]
  const [open, setOpen] = useState(copy.open)
  const listId = useId()
  if (props.entries.length === 0) return null
  const { context } = props
  const bytes = props.entries.reduce((sum, entry) => sum + (context.space.get(entry.path) ?? 0), 0)
  return (
    <section className="space-y-2">
      <Button
        variant="unstyled"
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('size-3.5 text-text-tertiary transition-transform', open && 'rotate-90')}
        />
        <span className="text-sm font-medium text-text-primary">{copy.title}</span>
        <span className="text-xs text-text-tertiary tabular-nums">
          {String(props.entries.length)} · about {formatBytes(bytes)}
        </span>
      </Button>
      {/* Always rendered, so the toggle's aria-controls names an element that exists. */}
      <div id={listId} hidden={!open} className="space-y-2">
        {open ? (
          <>
            <p className="pl-5.5 text-xs text-text-tertiary">{copy.description}</p>
            <ul
              aria-label={copy.title}
              className="overflow-hidden rounded-lg border border-border bg-bg"
            >
              {props.entries.map((entry) => (
                <WorktreeInventoryRow
                  key={entry.path}
                  entry={entry}
                  projectName={context.projectNames.get(entry.projectPath) ?? entry.projectPath}
                  space={context.space.get(entry.path)}
                  busy={context.busyPaths.has(entry.path)}
                  now={context.now}
                  onRemove={context.onRemove}
                  onConfirm={context.onConfirm}
                />
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </section>
  )
}
