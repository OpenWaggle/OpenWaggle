import { SessionId } from '@shared/types/brand'
import { resolveSessionStatusPill } from '@shared/types/session-status'
import { useSessionStatusStore } from '@/features/sessions/state'
import type { HiveSession } from '@/queries/session-hive-contract'
import { hiveRowStateLabel } from '../lib/hive-tree-model'

/**
 * A Hive member's state in the Hive panel's words: who acts next and why (ADR 0059), or its live
 * Session status when the rule has nothing to say. Shared so a transcript row and the panel never
 * disagree. The live status keeps a parked request and a starting Run current between reads.
 */
export function useHiveSessionState(session: HiveSession) {
  // Unknown until the window has seen the Session: the Host's parked-request fact stands then.
  const liveStatus = useSessionStatusStore((store) =>
    store.statuses.get(SessionId(String(session.id))),
  )
  const statusView = resolveSessionStatusPill(liveStatus ?? 'idle')
  return {
    /** The live status dot's colour, when the Session is not idle. */
    statusColor: statusView?.colorVar ?? null,
    state: hiveRowStateLabel(session, statusView?.shortLabel ?? 'Idle', liveStatus),
  }
}
