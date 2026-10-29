import type { WorktreeInventoryEntry } from '@shared/types/worktree-inventory'
import { FolderOpen } from 'lucide-react'
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { WorkspaceCleanupFailure } from '@/features/project-actions/components'
import { cn } from '@/shared/lib/cn'
import { formatBytes } from '@/shared/lib/format'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import type { WorktreeRemovalRequest } from './use-worktree-removal'
import {
  archivedAgo,
  attentionLabel,
  daysBetween,
  keptReasonLabel,
  worktreeTitle,
} from './worktree-inventory-format'

export interface WorktreeRowProps {
  readonly entry: WorktreeInventoryEntry
  readonly projectName: string
  /** Reclaimable space: a number, `undefined` while measuring, null when it could not be read. */
  readonly space: number | null | undefined
  readonly busy: boolean
  readonly now: number
  /** Remove at once; only rows that are safe to remove use it, after a second click. */
  readonly onRemove: (request: WorktreeRemovalRequest) => void
  /** Open the confirmation dialog with a fresh preview. */
  readonly onConfirm: (request: WorktreeRemovalRequest) => void
}

function request(entry: WorktreeInventoryEntry, options: Partial<WorktreeRemovalRequest> = {}) {
  return {
    path: entry.path,
    projectPath: entry.projectPath,
    skipCleanup: false,
    force: false,
    ...options,
  }
}

function hasAttention(
  entry: WorktreeInventoryEntry,
  kind: WorktreeInventoryEntry['attention'][number]['kind'],
) {
  return entry.attention.some((attention) => attention.kind === kind)
}

/** What stops even Archive & remove: a Run, a terminal, an Action, the open project, the app. */
function hardBlockers(entry: WorktreeInventoryEntry) {
  const running = entry.sessions.find((session) => session.running)
  return [
    ...(running ? [`The Session “${running.title}” has a Run.`] : []),
    ...entry.blockers
      .filter((blocker) => blocker.kind !== 'session')
      .map((blocker) => blocker.message),
  ]
}

function SpaceLabel({ space }: { readonly space: number | null | undefined }) {
  if (space === undefined) return <span className="text-text-tertiary">Measuring…</span>
  if (space === null) return <span className="text-text-tertiary">Size unknown</span>
  return <span className="text-text-secondary">Frees about {formatBytes(space)}</span>
}

function MetaLine(props: Pick<WorktreeRowProps, 'entry' | 'projectName' | 'now'>) {
  const { entry } = props
  const parts = [
    props.projectName,
    entry.branch ?? 'detached',
    entry.managed && entry.sessions.length === 0 ? 'No Session uses this worktree' : null,
    entry.archivedAt !== null ? archivedAgo(entry.archivedAt, props.now) : null,
  ].filter((part) => part !== null)
  return <span className="truncate text-xs text-text-tertiary">{parts.join(' · ')}</span>
}

function AutomaticRemovalNote({ entry, now }: Pick<WorktreeRowProps, 'entry' | 'now'>) {
  const decision = entry.automaticRemoval
  if (decision.kind === 'kept') {
    return (
      <span className="text-xs text-warning">
        Kept by automatic removal: {keptReasonLabel(decision.reason)}.
      </span>
    )
  }
  if (decision.kind === 'waiting') {
    const days = Math.max(1, daysBetween(now, decision.dueAt))
    return (
      <span className="text-xs text-text-tertiary">
        Removed automatically in {String(days)} {days === 1 ? 'day' : 'days'}
      </span>
    )
  }
  return null
}

function RevealButton({ path, title }: { readonly path: string; readonly title: string }) {
  const showToast = useUIStore((state) => state.showToast)
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={`Show folder of ${title}`}
      title={path}
      onClick={() =>
        void api
          .revealPath(path)
          .catch(() => showToast('Could not show the worktree folder.', 'error'))
      }
    >
      <FolderOpen aria-hidden="true" className="size-3.5" />
    </Button>
  )
}

/**
 * Remove, then a second click to confirm: these worktrees hold nothing that is not kept. Each
 * click swaps the focused button for others, so focus moves to the one that replaces it.
 */
function InlineRemove(props: {
  readonly busy: boolean
  readonly title: string
  readonly onConfirm: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const removeRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const show = (next: boolean) => {
    flushSync(() => setConfirming(next))
    ;(next ? cancelRef : removeRef).current?.focus()
  }
  // A removal that started elsewhere (Free) closes the confirmation: the row is already going.
  if (!confirming || props.busy) {
    /*
     * aria-disabled, not disabled, while removing: Confirm hands focus to this button, and a
     * natively disabled button would drop it to the page.
     */
    return (
      <Button
        ref={removeRef}
        variant="secondary"
        size="xs"
        className={cn(props.busy && 'cursor-not-allowed opacity-50')}
        aria-label={props.busy ? `Removing ${props.title}` : `Remove ${props.title}`}
        aria-disabled={props.busy}
        onClick={() => {
          if (!props.busy) show(true)
        }}
      >
        {props.busy ? 'Removing…' : 'Remove'}
      </Button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <Button
        ref={cancelRef}
        variant="ghost"
        size="xs"
        aria-label={`Cancel removing ${props.title}`}
        onClick={() => show(false)}
      >
        Cancel
      </Button>
      <Button
        variant="danger"
        size="xs"
        aria-label={`Confirm remove ${props.title}`}
        onClick={() => {
          show(false)
          props.onConfirm()
        }}
      >
        Confirm remove
      </Button>
    </span>
  )
}

/**
 * The forced removal a row offers: discarding changes, ignoring Git's lock, or both. A locked
 * worktree whose changes Git could not report may have some, so it is offered as a discard.
 */
function forcedRemoval(entry: WorktreeInventoryEntry) {
  const ignoresLock = hasAttention(entry, 'locked')
  const discardsChanges =
    hasAttention(entry, 'uncommitted-changes') ||
    (ignoresLock && entry.uncommittedChangeCount === null)
  return { force: discardsChanges || ignoresLock, discardsChanges, ignoresLock }
}

function forcedLabel(forced: ReturnType<typeof forcedRemoval>) {
  if (forced.discardsChanges) return 'Discard & remove'
  return forced.ignoresLock ? 'Unlock & remove' : 'Remove'
}

function RowAction(props: WorktreeRowProps) {
  const { entry } = props
  const title = worktreeTitle(entry)
  if (entry.group === 'safe') {
    return (
      <InlineRemove
        busy={props.busy}
        title={title}
        onConfirm={() => props.onRemove(request(entry))}
      />
    )
  }
  const forced = forcedRemoval(entry)
  if (entry.group === 'in-use') {
    if (hardBlockers(entry).length > 0) return null
    return (
      <Button
        variant="secondary"
        size="xs"
        aria-label={`Archive & remove ${title}…`}
        disabled={props.busy}
        onClick={() => props.onConfirm(request(entry, { archiveSessions: true, ...forced }))}
      >
        Archive & remove…
      </Button>
    )
  }
  if (entry.cleanupFailure) return null
  const label = forcedLabel(forced)
  return (
    <Button
      variant={forced.discardsChanges ? 'danger' : 'secondary'}
      size="xs"
      aria-label={`${label} ${title}…`}
      disabled={props.busy}
      onClick={() => props.onConfirm(request(entry, forced))}
    >
      {label}…
    </Button>
  )
}

/** One worktree: whose it is, what removing it frees, and the removal it allows. */
export function WorktreeInventoryRow(props: WorktreeRowProps) {
  const { entry } = props
  const blockers = entry.group === 'in-use' ? hardBlockers(entry) : []
  return (
    <li className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-xs font-medium text-text-primary" title={entry.path}>
            {worktreeTitle(entry)}
          </span>
          <MetaLine entry={entry} projectName={props.projectName} now={props.now} />
          {entry.attention.length > 0 ? (
            <span className="text-xs text-text-secondary">
              {entry.attention.map(attentionLabel).join(' · ')}
            </span>
          ) : null}
          {blockers.length > 0 ? (
            <span className="text-xs text-text-tertiary">In use: {blockers.join(' ')}</span>
          ) : null}
          <AutomaticRemovalNote entry={entry} now={props.now} />
        </div>
        <span className="shrink-0 text-xs tabular-nums">
          <SpaceLabel space={props.space} />
        </span>
        <RevealButton path={entry.path} title={worktreeTitle(entry)} />
        <RowAction {...props} />
      </div>
      {entry.cleanupFailure ? (
        <WorkspaceCleanupFailure
          projectPath={entry.projectPath}
          initial={entry.cleanupFailure.preparation}
          generationMismatch={entry.cleanupFailure.generationMismatch}
          generationMismatchMessage={entry.cleanupFailure.generationMismatchMessage}
          busy={props.busy || blockers.length > 0}
          onRetry={() => props.onConfirm(request(entry))}
          onDeleteAnyway={() => props.onConfirm(request(entry, { skipCleanup: true }))}
          onForceRemove={() => props.onConfirm(request(entry, { skipCleanup: true, force: true }))}
        />
      ) : null}
    </li>
  )
}
