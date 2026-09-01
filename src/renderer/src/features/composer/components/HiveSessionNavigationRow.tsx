import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import type { DelegationState } from '@shared/types/session-collaboration'
import { IDLE_ROW_COLOR_VAR, resolveSessionStatusPill } from '@shared/types/session-status'
import { ChessQueen, ChevronRight, Pickaxe } from 'lucide-react'
import { useSessionStatusStore } from '@/features/sessions/state'
import { Button } from '@/shared/ui/Button'

const DELEGATION_LABELS: Readonly<Record<DelegationState, string>> = {
  working: 'Working',
  waiting: 'Waiting',
  needs_attention: 'Needs attention',
  ready_for_review: 'Ready for review',
  revision_requested: 'Revision requested',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
}

export function isDoneWorker(session: SessionSummary) {
  const state = session.lineage?.delegationState
  return state === 'accepted' || state === 'cancelled'
}

export function HiveSessionNavigationRow({
  session,
  lineageRole,
  onNavigateSession,
}: {
  readonly session: SessionSummary
  readonly lineageRole: 'queen' | 'worker'
  readonly onNavigateSession: (sessionId: SessionId) => void
}) {
  const status = useSessionStatusStore((state) => state.statuses.get(session.id) ?? 'idle')
  const statusView = resolveSessionStatusPill(status)
  const Icon = lineageRole === 'queen' ? ChessQueen : Pickaxe
  const delegationState = session.lineage?.delegationState
  const statusLabel = delegationState
    ? DELEGATION_LABELS[delegationState]
    : (statusView?.shortLabel ?? 'Idle')

  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={() => onNavigateSession(session.id)}
      aria-label={`Open ${lineageRole === 'queen' ? 'Queen' : 'Worker'} Session: ${session.title} · Status: ${statusLabel}`}
      title={`Open ${lineageRole === 'queen' ? 'Queen' : 'Worker'} Session: ${session.title}`}
      className="group flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-bg-hover"
    >
      <Icon className="size-3.5 shrink-0 text-text-tertiary" />
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: statusView?.colorVar ?? IDLE_ROW_COLOR_VAR }}
      />
      <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{session.title}</span>
      <span
        className="shrink-0 text-xs font-medium"
        style={{ color: statusView?.labelColorVar ?? 'var(--color-text-muted)' }}
      >
        {statusLabel}
      </span>
      <ChevronRight className="size-3 shrink-0 text-text-muted group-hover:text-text-secondary" />
    </Button>
  )
}
