import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { resolveSessionStatusPill, TERMINAL_STATUSES } from '@shared/types/session-status'
import {
  CircleCheck,
  CirclePause,
  ClipboardList,
  GitCompareArrows,
  Loader2,
  MessageCircle,
  XCircle,
} from 'lucide-react'
import { useSessionStatusStore } from '@/features/sessions/state'
import { WaggleBeeIcon } from '@/features/waggle/components'
import {
  isAttentionState,
  isInFlightState,
  resolveSidebarRowState,
  sessionHasInterruptedRun,
  sidebarRowStateMeta,
} from '../lib/sidebar-row-state'

export const SESSION_STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  GitCompareArrows,
  Loader2,
  CircleCheck,
  CirclePause,
  MessageCircle,
  ClipboardList,
  XCircle,
  WaggleBee: WaggleBeeIcon,
}

/**
 * A finished run the user has already seen reads as idle.
 *
 * Without this, a completed session would keep its tick forever and the tick would stop
 * meaning "this finished while you were away".
 */
function useVisibleStatus(sessionId: SessionId) {
  const status = useSessionStatusStore((s) => s.statuses.get(sessionId) ?? 'idle')
  const completedAt = useSessionStatusStore((s) => s.completedAt.get(sessionId))
  const lastVisited = useSessionStatusStore((s) => s.lastVisitedAt.get(sessionId))

  const isSeen =
    TERMINAL_STATUSES.has(status) &&
    completedAt !== undefined &&
    lastVisited !== undefined &&
    completedAt <= lastVisited

  return isSeen ? 'idle' : status
}

/**
 * Everything a session row needs in order to draw itself.
 *
 * Tier and appearance both come from `sidebar-row-state`, which is also what the chips and the
 * project roll-ups read, so a row and its project heading cannot describe one session differently.
 */
export function useSessionRowStatus(sessionId: SessionId, session: SessionSummary) {
  const visibleStatus = useVisibleStatus(sessionId)
  const phase = useSessionStatusStore((s) => s.phases.get(sessionId) ?? null)
  const pill = resolveSessionStatusPill(visibleStatus)
  const hasInterruptedRun = sessionHasInterruptedRun(session)
  const state = resolveSidebarRowState({ status: visibleStatus, hasInterruptedRun })
  const meta = sidebarRowStateMeta(state)

  return {
    phase,
    hasInterruptedRun,
    animateClass: pill?.animateClass ?? null,
    StatusIcon: pill ? (SESSION_STATUS_ICON[pill.icon] ?? null) : null,
    isAttention: isAttentionState(state),
    isInFlight: isInFlightState(state),
    rowColorVar: meta.colorVar,
    stateLabel: meta.shortLabel,
    stateColorVar: meta.labelColorVar,
  }
}
