import { runningWorkerCount } from '@shared/domain/running-workers'
import type { SessionSummary } from '@shared/types/session'
import { useChat } from '@/features/chat/hooks'
import { useSessions } from '@/features/sessions/hooks'

/**
 * The open Session's Running Workers (ADR 0065), for the header line and the Hive rail dot, which
 * must agree. The catalog entry wins: it is read again whenever a Worker below starts or settles a
 * Run, and the open tree is not. The tree answers only for a Session the catalog does not hold.
 */
export function activeSessionRunningWorkerCount(input: {
  readonly activeSessionId: unknown
  readonly sessions: readonly SessionSummary[]
  readonly archivedSessions: readonly SessionSummary[]
  readonly treeSession: SessionSummary | null | undefined
}) {
  const id = String(input.activeSessionId)
  const catalog = [...input.sessions, ...input.archivedSessions].find(
    (session) => String(session.id) === id,
  )
  const tree = input.treeSession && String(input.treeSession.id) === id ? input.treeSession : null
  return runningWorkerCount((catalog ?? tree)?.lineage)
}

/** The open Session's Running Workers from the stores, for the Hive rail dot. */
export function useActiveSessionRunningWorkerCount() {
  const { activeSessionId } = useChat()
  const { activeSessionTree, archivedSessions, sessions } = useSessions()
  return activeSessionRunningWorkerCount({
    activeSessionId,
    sessions,
    archivedSessions,
    treeSession: activeSessionTree?.session,
  })
}
