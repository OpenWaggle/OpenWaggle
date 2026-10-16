import { SessionId } from '@shared/types/brand'
import { resolveSessionStatusPill } from '@shared/types/session-status'
import { useSessionStatusStore } from '@/features/sessions/state'
import type { HiveSession } from '@/queries/session-hive-contract'
import { hiveRowStateLabel } from '../lib/hive-tree-model'

/**
 * A Hive member's state in the Hive panel's words: its Delegation state, or its live Session
 * status when it has none. Shared so a transcript row and the panel never disagree.
 */
export function useHiveSessionState(session: HiveSession) {
  const status = useSessionStatusStore(
    (store) => store.statuses.get(SessionId(String(session.id))) ?? 'idle',
  )
  const statusView = resolveSessionStatusPill(status)
  return {
    /** The live status dot's colour, when the Session is not idle. */
    statusColor: statusView?.colorVar ?? null,
    state: hiveRowStateLabel(session, statusView?.shortLabel ?? 'Idle'),
  }
}
