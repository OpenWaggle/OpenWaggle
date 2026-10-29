import type { WorktreeInventoryEntry } from '@shared/types/worktree-inventory'
import { FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { WorkspaceCleanupFailure } from '@/features/project-actions/components'
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
    entry.managed ? null : 'Created outside OpenWaggle',
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

function RevealButton({ path }: { readonly path: string }) {
  const showToast = useUIStore((state) => state.showToast)
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label="Reveal in Finder"
      title={path}
      onClick={() =>
        void api.revealPath(path).catch(() => showToast('Could not reveal the worktree.', 'error'))
      }
    >
      <FolderOpen aria-hidden="true" className="size-3.5" />
    </Button>
  )
}

/** Remove, then a second click to confirm: these worktrees hold nothing that is not kept. */
function InlineRemove(props: { readonly busy: boolean; readonly onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <Button
        variant="secondary"
        size="xs"
        disabled={props.busy}
        onClick={() => setConfirming(true)}
      >
        {props.busy ? 'Removing…' : 'Remove'}
      </Button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <Button
        variant="danger"
        size="xs"
        onClick={() => {
          setConfirming(false)
          props.onConfirm()
        }}
      >
        Confirm remove
      </Button>
    </span>
  )
}

function RowAction(props: WorktreeRowProps) {
  const { entry } = props
  if (entry.group === 'safe') {
    return <InlineRemove busy={props.busy} onConfirm={() => props.onRemove(request(entry))} />
  }
  const discard = hasAttention(entry, 'uncommitted-changes') || hasAttention(entry, 'locked')
  if (entry.group === 'in-use') {
    if (hardBlockers(entry).length > 0) return null
    return (
      <Button
        variant="secondary"
        size="xs"
        disabled={props.busy}
        onClick={() => props.onConfirm(request(entry, { archiveSessions: true, force: discard }))}
      >
        Archive & remove…
      </Button>
    )
  }
  if (entry.cleanupFailure) return null
  return (
    <Button
      variant={discard ? 'danger' : 'secondary'}
      size="xs"
      disabled={props.busy}
      onClick={() => props.onConfirm(request(entry, { force: discard }))}
    >
      {discard ? 'Discard & remove…' : 'Remove…'}
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
        <RevealButton path={entry.path} />
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
