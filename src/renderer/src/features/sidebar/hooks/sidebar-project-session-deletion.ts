import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'

/** Validate the whole Hive before deleting anything, then remove Workers before their parents. */
export async function deleteProjectSessionsChildrenFirst(
  sessions: readonly SessionSummary[],
  deleteSession: (sessionId: SessionId) => Promise<void>,
) {
  if (
    sessions.some(
      (session) =>
        session.lineage?.role === 'worker' &&
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
      [...pending.values()].flatMap((session) =>
        session.lineage?.parentSessionId ? [String(session.lineage.parentSessionId)] : [],
      ),
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

import { SESSION_DELETE_BLOCKED_ACTIVE_WORKER_MESSAGE } from '@shared/constants/session-lifecycle'
