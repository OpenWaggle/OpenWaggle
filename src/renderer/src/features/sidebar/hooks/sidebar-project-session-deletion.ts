import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'

/** Delete each Hive level in parallel, but never delete a parent before its Workers. */
export async function deleteProjectSessionsChildrenFirst(
  sessions: readonly SessionSummary[],
  deleteSession: (sessionId: SessionId) => Promise<void>,
) {
  const pending = new Map(sessions.map((session) => [String(session.id), session]))

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

    await Promise.all(leaves.map((session) => deleteSession(session.id)))
    for (const session of leaves) pending.delete(String(session.id))
  }
}
