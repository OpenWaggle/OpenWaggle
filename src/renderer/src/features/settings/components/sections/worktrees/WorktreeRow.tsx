import type { WorktreeSessionUsage } from '@shared/types/worktree-usage'
import { formatWorktreePathForDisplay } from '@shared/utils/worktree'
import { WorkspaceCleanupFailure } from '@/features/project-actions/components'
import { Button } from '@/shared/ui/Button'
import type { PreparedWorktree } from './use-project-worktrees'
import type { WorktreeRemovalRequest } from './WorktreeRemovalDialog'

function sessionLabel(session: WorktreeSessionUsage) {
  const state = session.running ? ' (running)' : session.archived ? ' (archived)' : ''
  return `${session.owner ? 'Session' : 'Local Session'}: ${session.title}${state}`
}

function WorktreeSessions({ sessions }: { readonly sessions: readonly WorktreeSessionUsage[] }) {
  if (sessions.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5">
      {sessions.map((session) => (
        <li key={session.sessionId} className="text-xs text-text-secondary">
          {sessionLabel(session)}
        </li>
      ))}
    </ul>
  )
}

/** One worktree: what it is, who uses it, and the removal it allows. */
export function WorktreeRow(props: {
  readonly projectPath: string
  readonly worktree: PreparedWorktree
  readonly busy: boolean
  readonly onRequestRemoval: (request: WorktreeRemovalRequest) => void
}) {
  const { worktree } = props
  const blockers = worktree.usage?.blockers ?? []
  const inUse = blockers.length > 0
  const removable = !worktree.isMain && !inUse
  const request = (skipCleanup: boolean, force: boolean) =>
    props.onRequestRemoval({ path: worktree.path, skipCleanup, force })
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium break-all text-text-primary">
          {formatWorktreePathForDisplay(worktree.path)}
          {worktree.isMain ? ' (main)' : ''}
        </span>
        <span className="font-mono text-xs break-all text-text-tertiary">{worktree.path}</span>
        <span className="text-xs text-text-tertiary">{worktree.branch ?? 'detached'}</span>
        <WorktreeSessions sessions={worktree.usage?.sessions ?? []} />
        {!worktree.isMain && inUse ? (
          <p className="text-xs text-text-tertiary">
            In use: {blockers.map((blocker) => blocker.message).join(' ')}
          </p>
        ) : null}
      </div>
      {!worktree.isMain && (
        <Button
          variant="secondary"
          size="xs"
          disabled={props.busy || inUse}
          onClick={() => request(false, false)}
        >
          Remove
        </Button>
      )}
      {worktree.preparation ? (
        <div className="w-full">
          <WorkspaceCleanupFailure
            projectPath={props.projectPath}
            initial={worktree.preparation}
            generationMismatch={worktree.generationMismatch}
            generationMismatchMessage={worktree.generationMismatchMessage}
            busy={props.busy || inUse}
            onRetry={() => request(false, false)}
            onDeleteAnyway={() => request(true, false)}
            onForceRemove={() => request(true, true)}
          />
        </div>
      ) : removable ? (
        <details className="w-full border-t border-border pt-2">
          <summary className="cursor-pointer text-xs text-error-text">Force remove…</summary>
          <p className="my-2 text-xs text-text-tertiary">
            Skip workspace cleanup and remove this worktree even if it has uncommitted changes or is
            locked. This cannot be undone.
          </p>
          <Button variant="danger" disabled={props.busy} onClick={() => request(true, true)}>
            Force remove
          </Button>
        </details>
      ) : null}
    </li>
  )
}
