import { RepositoryPath } from '@shared/types/brand'
import type { WorktreeRemovalPreview } from '@shared/types/worktree-usage'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { api } from '@/shared/lib/ipc'
import { ipcErrorMessage } from '@/shared/lib/ipc-error-message'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { Spinner } from '@/shared/ui/Spinner'
import type { WorktreeRemovalRequest } from './use-worktree-removal'

async function readRemovalPreview(
  repositoryPath: RepositoryPath,
  worktreePath: string,
): Promise<WorktreeRemovalPreview> {
  const result = await api.manageProjectActions({
    scope: { projectPath: repositoryPath },
    operation: { type: 'worktree-removal-preview', path: worktreePath },
  })
  if (result.type !== 'worktree-removal-preview') {
    throw new Error('Unexpected worktree removal preview.')
  }
  return result
}

function removalPreviewQueryOptions(repositoryPath: RepositoryPath, worktreePath: string) {
  return queryOptions({
    queryKey: ['worktree-removal-preview', repositoryPath, worktreePath],
    queryFn: () => readRemovalPreview(repositoryPath, worktreePath),
    // Always read fresh: the confirmation is only as good as its newest facts.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

/** A forced removal that is not a cleanup recovery: it discards changes, ignores a lock, or both. */
function forcedFor(request: WorktreeRemovalRequest) {
  return request.force && !request.skipCleanup
}

function removalTitle(request: WorktreeRemovalRequest) {
  if (request.archiveSessions) return 'Archive its Sessions and remove this worktree?'
  if (forcedFor(request)) {
    return request.ignoresLock && !request.discardsChanges
      ? 'Unlock and remove this worktree?'
      : 'Discard the changes and remove this worktree?'
  }
  if (request.force) return 'Remove this worktree without its cleanup?'
  if (request.skipCleanup) return 'Delete this worktree without its cleanup?'
  return 'Remove this worktree?'
}

const RECREATE_NOTE =
  'If you restore a Session later, it offers to recreate the worktree from the kept branch, or to continue in the current checkout.'
const LOCK_NOTE = ' Git has it locked; removing it ignores the lock.'

function forcedConsequence(request: WorktreeRemovalRequest) {
  const lock = request.ignoresLock ? LOCK_NOTE : ''
  if (request.ignoresLock && !request.discardsChanges) {
    return `Its folder is deleted, including ignored files such as .env and node_modules.${lock} The branch is kept.`
  }
  return `Its folder is deleted with its uncommitted changes, which cannot be undone.${lock} The branch and its commits are kept.`
}

function removalConsequence(request: WorktreeRemovalRequest) {
  if (request.archiveSessions) {
    const discard = request.discardsChanges ? ' Its uncommitted changes are discarded.' : ''
    const lock = request.ignoresLock ? LOCK_NOTE : ''
    return `Each Session below is archived, then the folder is deleted.${discard}${lock} The branch is kept. ${RECREATE_NOTE}`
  }
  if (forcedFor(request)) return forcedConsequence(request)
  if (request.force)
    return 'Its folder is deleted even if it has uncommitted changes or is locked, and Workspace cleanup is skipped. This cannot be undone.'
  if (request.skipCleanup)
    return 'Its folder is deleted without running the Workspace cleanup. This cannot be undone.'
  return 'Its folder is deleted, including ignored files such as .env and node_modules. Git refuses if it has uncommitted changes. The branch is kept.'
}

function unpublishedWarning(preview: WorktreeRemovalPreview) {
  const count = preview.unpublishedCommitCount
  if (count === null)
    return 'OpenWaggle could not check whether this branch has commits that are not on a remote.'
  if (count === 0) return null
  const commits = count === 1 ? '1 commit that is' : `${String(count)} commits that are`
  if (preview.branch === null)
    return `The detached HEAD has ${commits} not on any remote. With no branch, that work may be lost once the worktree is gone; create a branch for it first.`
  return `${preview.branch} has ${commits} not on any remote. The branch is kept, but push it first if you need that work elsewhere.`
}

/** What still stops the removal; an Archive & remove expects the open Sessions it archives. */
function removalBlockers(preview: WorktreeRemovalPreview, request: WorktreeRemovalRequest) {
  const blockers = preview.usage.blockers.filter(
    (blocker) => !(request.archiveSessions && blocker.kind === 'session'),
  )
  const running = preview.usage.sessions.find((session) => session.running)
  if (!request.archiveSessions || !running) return blockers
  return [
    ...blockers,
    {
      kind: 'session',
      message: `The Session “${running.title}” has a Run in this worktree. Stop it first.`,
    } as const,
  ]
}

function PreviewDetails(props: {
  readonly preview: WorktreeRemovalPreview
  readonly request: WorktreeRemovalRequest
}) {
  const { preview } = props
  const warning = unpublishedWarning(preview)
  const owners = preview.usage.sessions.filter((session) => session.owner)
  // Archive & remove archives every Session working in it, so it names every one (ADR 0060).
  const listed = props.request.archiveSessions ? preview.usage.sessions : owners
  const blockers = removalBlockers(preview, props.request)
  return (
    <div className="mt-3 space-y-2 text-xs leading-5">
      <p className="text-text-secondary">Branch: {preview.branch ?? 'detached'}</p>
      {listed.map((session) => (
        <p key={session.sessionId} className="text-text-secondary">
          {props.request.archiveSessions && !session.archived ? 'Archives' : 'Session'}:{' '}
          {session.title}
          {session.archived ? ' (archived)' : ''}
        </p>
      ))}
      {owners.length > 0 && !props.request.archiveSessions ? (
        <p className="text-text-tertiary">{RECREATE_NOTE}</p>
      ) : null}
      {warning ? (
        <p role="alert" className="text-warning">
          {warning}
        </p>
      ) : null}
      {blockers.length > 0 ? (
        <div role="alert" className="text-error-text">
          <p>It cannot be removed now:</p>
          <ul className="list-disc pl-4">
            {blockers.map((blocker) => (
              <li key={blocker.kind}>{blocker.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function confirmLabel(request: WorktreeRemovalRequest) {
  if (request.archiveSessions) return 'Archive & remove'
  if (forcedFor(request)) {
    return request.ignoresLock && !request.discardsChanges ? 'Unlock & remove' : 'Discard & remove'
  }
  if (request.force) return 'Remove without cleanup'
  return 'Remove worktree'
}

/**
 * Confirms a worktree removal with what it would lose (issue #353). The Host checks again
 * when it removes, so the confirmation can only be stricter than the removal, never looser.
 */
export function WorktreeRemovalDialog(props: {
  readonly request: WorktreeRemovalRequest
  readonly onConfirm: (request: WorktreeRemovalRequest) => void
  readonly onClose: () => void
}) {
  const titleId = useId()
  const preview = useQuery(
    removalPreviewQueryOptions(RepositoryPath(props.request.projectPath), props.request.path),
  )
  const blocked =
    preview.data === undefined || removalBlockers(preview.data, props.request).length > 0
  return (
    <ModalDialog labelledBy={titleId} onClose={props.onClose}>
      <div className="p-5">
        <h2 id={titleId} className="text-sm font-semibold text-text-primary">
          {removalTitle(props.request)}
        </h2>
        <p className="mt-2 font-mono text-xs break-all text-text-primary">{props.request.path}</p>
        <p className="mt-2 text-xs leading-5 text-text-secondary">
          {removalConsequence(props.request)}
        </p>
        {preview.isPending ? (
          <p className="mt-3 flex items-center gap-2 text-xs text-text-tertiary">
            <Spinner size="sm" /> Checking the worktree…
          </p>
        ) : preview.isError ? (
          <p role="alert" className="mt-3 text-xs text-error-text">
            Could not check this worktree: {ipcErrorMessage(preview.error)}
          </p>
        ) : (
          <PreviewDetails preview={preview.data} request={props.request} />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={blocked}
            onClick={() =>
              props.onConfirm({
                ...props.request,
                sessionIds: preview.data?.usage.sessions.map((session) => session.sessionId) ?? [],
              })
            }
          >
            {confirmLabel(props.request)}
          </Button>
        </div>
      </div>
    </ModalDialog>
  )
}
