import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import {
  IDLE_ROW_COLOR_VAR,
  INTERRUPTED_RUN_PILL,
  resolveSessionStatusPill,
  type SessionStatus,
  TERMINAL_STATUSES,
} from '@shared/types/session-status'
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
 * Which tier a row belongs to, and therefore how loudly it reads.
 *
 * One loud tier for anything needing a human, one calm tier for work in flight, one quiet
 * tier for everything else. Ranked rather than additive: a session that both failed and is
 * reconnecting is a failure first.
 */
function resolveRowTier(status: SessionStatus, hasInterruptedRun: boolean) {
  if (hasInterruptedRun || status === 'error' || status === 'awaiting-input') return 'attention'
  if (status === 'working' || status === 'connecting') return 'in-flight'
  return 'quiet'
}

/** The word, the row accent and the label colour for a row's current state. */
function resolveRowAppearance(
  pill: ReturnType<typeof resolveSessionStatusPill>,
  hasInterruptedRun: boolean,
) {
  if (hasInterruptedRun) {
    return {
      rowColorVar: INTERRUPTED_RUN_PILL.colorVar,
      stateLabel: INTERRUPTED_RUN_PILL.shortLabel,
      stateColorVar: INTERRUPTED_RUN_PILL.labelColorVar,
    }
  }
  return {
    rowColorVar: pill?.colorVar ?? IDLE_ROW_COLOR_VAR,
    stateLabel: pill?.shortLabel ?? '',
    stateColorVar: pill?.labelColorVar ?? IDLE_ROW_COLOR_VAR,
  }
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

/** Everything a session row needs in order to draw itself. */
export function useSessionRowStatus(sessionId: SessionId, session: SessionSummary) {
  const visibleStatus = useVisibleStatus(sessionId)
  const phase = useSessionStatusStore((s) => s.phases.get(sessionId) ?? null)
  const pill = resolveSessionStatusPill(visibleStatus)
  const hasInterruptedRun = session.branches?.some((branch) => branch.interruptedRun) ?? false
  const tier = resolveRowTier(visibleStatus, hasInterruptedRun)

  return {
    phase,
    hasInterruptedRun,
    animateClass: pill?.animateClass ?? null,
    StatusIcon: pill ? (SESSION_STATUS_ICON[pill.icon] ?? null) : null,
    isAttention: tier === 'attention',
    isInFlight: tier === 'in-flight',
    ...resolveRowAppearance(pill, hasInterruptedRun),
  }
}
