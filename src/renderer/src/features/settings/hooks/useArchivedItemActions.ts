import {
  type ArchivedItem,
  type ArchivedItemChanged,
  type ArchivedItemRef,
  archivedItemKey,
} from '@shared/types/archived-items'
import type { SessionId } from '@shared/types/brand'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useComposerStore } from '@/features/composer/state'
import { useSessionStore } from '@/features/sessions/state'
import {
  type ArchivedSessionsDeletion,
  useArchivedDeleteSessionsMutation,
  useSetArchivedItemsMutation,
} from '@/queries/archived-sessions'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'

function describeError(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function itemsLabel(count: number) {
  return count === 1 ? '1 item' : `${count.toLocaleString()} items`
}

function sessionsLabel(count: number) {
  return count === 1 ? '1 session' : `${count.toLocaleString()} sessions`
}

function branchesLabel(count: number) {
  return count === 1 ? '1 branch' : `${count.toLocaleString()} branches`
}

/** What a restore toast names: the one item's title, or how many items. */
function restoredMessage(changed: readonly ArchivedItemRef[], titles: ReadonlyMap<string, string>) {
  const [only] = changed
  const title = changed.length === 1 && only ? titles.get(archivedItemKey(only)) : undefined
  return title ? `Restored “${title}”` : `Restored ${itemsLabel(changed.length)}`
}

function deleteConfirmation(sessionCount: number, skippedBranches: number) {
  const subject = sessionCount === 1 ? 'this session' : `these ${sessionsLabel(sessionCount)}`
  const branches =
    skippedBranches > 0
      ? ` The ${branchesLabel(skippedBranches)} in the selection ${skippedBranches === 1 ? 'stays' : 'stay'} archived: branches can only be restored.`
      : ''
  return {
    message:
      sessionCount === 1
        ? 'Delete permanently?'
        : `Delete ${sessionsLabel(sessionCount)} permanently?`,
    detail: `This permanently deletes ${subject}. This cannot be undone.${branches}`,
  }
}

/** What the user should hear after a delete: why some sessions remain, or nothing. */
function deletionProblem(result: ArchivedSessionsDeletion) {
  const [firstFailure] = result.failed
  if (firstFailure) {
    return `Could not delete ${sessionsLabel(result.failed.length)}: ${firstFailure.message}`
  }
  if (result.skipped.length > 0) {
    return `Kept ${sessionsLabel(result.skipped.length)} that left the archive before deleting.`
  }
  const [firstCleanup] = result.cleanupFailed
  if (!firstCleanup) return null
  return `Deleted, but could not clean up the local layout of ${sessionsLabel(result.cleanupFailed.length)}: ${firstCleanup.message}`
}

/**
 * Restore, Undo, delete, and open for Settings > Archived items. Restore offers Undo, which
 * archives the same items again; delete is permanent, so it is confirmed first, once per action
 * (CONTEXT.md). `onRemoved` hears which items left the archive.
 */
export function useArchivedItemActions(onRemoved: (refs: readonly ArchivedItemRef[]) => void) {
  const navigate = useNavigate()
  const loadSessions = useSessionStore((state) => state.loadSessions)
  const setArchived = useSetArchivedItemsMutation()
  const deleteSessions = useArchivedDeleteSessionsMutation()
  const [actionError, setActionError] = useState<string | null>(null)

  /** Archives again exactly what the restore brought back, at the Archive time each one had. */
  const undoRestore = (restored: readonly ArchivedItemChanged[]) => {
    setActionError(null)
    void setArchived
      .mutateAsync({
        archived: true,
        items: restored.map((entry) =>
          entry.archivedAt === null
            ? { ref: entry.ref }
            : { ref: entry.ref, archivedAt: entry.archivedAt },
        ),
      })
      .then((result) => {
        void loadSessions()
        if (result.failed.length > 0) {
          setActionError(`Could not archive ${itemsLabel(result.failed.length)} again.`)
        }
      })
      .catch((error: unknown) => setActionError(describeError(error, 'Undo failed.')))
  }

  const restore = (items: readonly Pick<ArchivedItem, 'ref' | 'title'>[]) => {
    if (items.length === 0) return
    setActionError(null)
    const titles = new Map(items.map((item) => [archivedItemKey(item.ref), item.title] as const))
    void setArchived
      .mutateAsync({ archived: false, items: items.map((item) => ({ ref: item.ref })) })
      .then((result) => {
        void loadSessions()
        const changedRefs = result.changed.map((entry) => entry.ref)
        // Skipped items left the archive elsewhere; drop them from the selection too.
        onRemoved([...changedRefs, ...result.skipped])
        if (changedRefs.length > 0) {
          useUIStore.getState().showActionToast({
            message: restoredMessage(changedRefs, titles),
            variant: 'success',
            action: { label: 'Undo', onClick: () => undoRestore(result.changed) },
          })
        }
        const [firstFailure] = result.failed
        if (firstFailure) {
          setActionError(
            `Could not restore ${itemsLabel(result.failed.length)}: ${firstFailure.message}`,
          )
        }
      })
      .catch((error: unknown) => setActionError(describeError(error, 'Restore failed.')))
  }

  const remove = async (refs: readonly ArchivedItemRef[]) => {
    const sessionIds: SessionId[] = refs.flatMap((ref) =>
      ref.kind === 'session' ? [ref.sessionId] : [],
    )
    if (sessionIds.length === 0) return
    setActionError(null)
    const confirmation = deleteConfirmation(sessionIds.length, refs.length - sessionIds.length)
    const confirmed = await api
      .showConfirm(confirmation.message, confirmation.detail)
      .catch((error: unknown) => {
        setActionError(describeError(error, 'Failed to open delete confirmation.'))
        return false
      })
    if (!confirmed) return
    try {
      const result = await deleteSessions.mutateAsync(sessionIds)
      for (const sessionId of result.deleted) {
        useComposerStore.getState().clearScopedDraftsForSession(String(sessionId))
      }
      onRemoved(
        [...result.deleted, ...result.skipped, ...result.missing].map((sessionId) => ({
          kind: 'session',
          sessionId,
        })),
      )
      setActionError(deletionProblem(result))
    } catch (error) {
      setActionError(describeError(error, 'Failed to permanently delete archived sessions.'))
    } finally {
      void loadSessions()
    }
  }

  /**
   * Opens the session with its archived notice; opening never restores it. A branch opens the
   * session it belongs to, where the branch stays hidden until it is restored.
   */
  const open = (ref: ArchivedItemRef) => {
    void navigate({ to: '/sessions/$sessionId', params: { sessionId: String(ref.sessionId) } })
  }

  return {
    restore,
    remove,
    open,
    pending: setArchived.isPending || deleteSessions.isPending,
    actionError,
    dismissError: () => setActionError(null),
  }
}
