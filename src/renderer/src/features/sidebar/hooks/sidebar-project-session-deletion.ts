import { SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE } from '@shared/constants/session-lifecycle'
import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { forgoRemovedSessionDraft } from '@/features/composer/state'
import { api } from '@/shared/lib/ipc'
import { deleteWorkspaceOwner } from '@/shell/workspace-panel-cleanup'
import { clearComposerDraftForSession } from './sidebar-action-utils'

/** Validate the whole Hive before deleting anything, then remove Workers before their parents. */
export async function deleteProjectSessionsChildrenFirst(
  sessions: readonly SessionSummary[],
  deleteSession: (sessionId: SessionId) => Promise<void>,
) {
  if (
    sessions.some(
      (session) =>
        session.lineage?.role === 'worker' &&
        session.lineage.historical !== true &&
        (session.lineage.delegationState === 'working' ||
          session.lineage.delegationState === 'waiting'),
    )
  ) {
    throw new Error(SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE)
  }
  const childCounts = new Map<string, number>()
  for (const session of sessions) {
    const parent = session.lineage?.parentSessionId
    if (parent) childCounts.set(String(parent), (childCounts.get(String(parent)) ?? 0) + 1)
  }
  if (
    sessions.some(
      (session) =>
        (session.lineage?.directWorkerCount ?? 0) > (childCounts.get(String(session.id)) ?? 0),
    )
  ) {
    throw new Error(
      'Cannot remove a project with Workers outside the confirmed project. Remove those Workers first.',
    )
  }
  const pending = new Map(sessions.map((session) => [String(session.id), session]))
  const deletionOrder: SessionId[] = []

  while (pending.size > 0) {
    const parentIds = new Set(
      [...pending.values()].flatMap((session) => [
        ...(session.lineage?.parentSessionId ? [String(session.lineage.parentSessionId)] : []),
        ...(session.derivation ? [String(session.derivation.sourceSessionId)] : []),
      ]),
    )
    const leaves = [...pending.values()].filter((session) => !parentIds.has(String(session.id)))
    if (leaves.length === 0) {
      throw new Error('Cannot delete project sessions because their Hive lineage contains a cycle.')
    }

    for (const session of leaves) {
      deletionOrder.push(session.id)
      pending.delete(String(session.id))
    }
  }
  for (const id of deletionOrder) await deleteSession(id)
}

/** A Session whose deletion may have been committed although it failed is gone if not found. */
async function sessionStillExists(id: SessionId) {
  try {
    return (await api.getSessionDetail(id)) !== null
  } catch {
    return false
  }
}

/**
 * Deletes one of a removed project's Sessions, with its draft, which is not carried to the
 * project's New session meanwhile. A Session the Host still has after a failed deletion keeps its
 * draft, carried as any other's if the Host removes it later.
 */
export async function deleteRemovedProjectSession(id: SessionId, releaseDrafts: (() => void)[]) {
  const releaseDraft = forgoRemovedSessionDraft(id)
  releaseDrafts.push(releaseDraft)
  await api.deleteSession(id, { removingProject: true }).catch(async (error: unknown) => {
    if (await sessionStillExists(id)) releaseDraft()
    throw error
  })
  clearComposerDraftForSession(id)
  await deleteWorkspaceOwner(String(id))
}
