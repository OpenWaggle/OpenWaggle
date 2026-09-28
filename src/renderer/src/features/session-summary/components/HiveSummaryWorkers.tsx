import { IDLE_ROW_COLOR_VAR, resolveSessionStatusPill } from '@shared/types/session-status'
import { ChessQueen, ChevronDown, ChevronRight, Pickaxe, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { useUnarchiveSessionMutation } from '@/queries/archived-sessions'
import { HIVE_DELEGATION_LABELS, type HiveSession } from '@/queries/session-hive-contract'
import { Button } from '@/shared/ui/Button'
import { hiveStateNeedsAttention } from '../model/session-hive-summary'
import { SessionSummaryPaginatedList } from './SessionSummaryPrimitives'

export function HiveArchivedWorkers({
  workers,
  onNavigateSession,
}: {
  readonly workers: readonly HiveSession[]
  readonly onNavigateSession: (sessionId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (workers.length === 0) return null
  return (
    <div>
      <Button
        variant="unstyled"
        className="flex min-h-7 items-center gap-1 rounded px-2 text-xs font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
        aria-label={expanded ? 'Collapse archived Workers' : 'Expand archived Workers'}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        Archived · {workers.length}
      </Button>
      {expanded ? (
        <fieldset aria-label="Archived Hive sessions" className="m-0 min-w-0 border-0 p-0">
          <div className="px-2 pb-0.5 pt-1 text-xs font-medium uppercase tracking-wide text-text-muted">
            Archived
          </div>
          <SessionSummaryPaginatedList
            items={workers}
            getKey={(worker) => worker.id}
            renderItem={(worker) => (
              <HiveArchivedWorkerRow worker={worker} onNavigateSession={onNavigateSession} />
            )}
          />
        </fieldset>
      ) : null}
    </div>
  )
}

/** Archived Workers stay navigable and can be restored to talk to them again. */
function HiveArchivedWorkerRow({
  worker,
  onNavigateSession,
}: {
  readonly worker: HiveSession
  readonly onNavigateSession: (sessionId: string) => void
}) {
  const unarchive = useUnarchiveSessionMutation()
  const loadSessions = useSessionStore((state) => state.loadSessions)
  const [failed, setFailed] = useState(false)

  function restore() {
    setFailed(false)
    void unarchive
      .mutateAsync(worker.id)
      .then(() => loadSessions())
      .catch(() => setFailed(true))
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <HiveSessionRow
            label="Archived"
            session={worker}
            onClick={() => onNavigateSession(String(worker.id))}
          />
        </div>
        <Button
          variant="unstyled"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
          aria-label={`Restore Worker Session: ${worker.title}`}
          title="Restore to the sidebar"
          disabled={unarchive.isPending}
          onClick={restore}
        >
          <RotateCcw aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="px-2 text-xs text-warning">
          Unable to restore {worker.title}.
        </p>
      ) : null}
    </div>
  )
}

export function HiveWorkerGroup({
  label,
  workers,
  rowLabel,
  onNavigateSession,
}: {
  readonly label: string
  readonly workers: readonly HiveSession[]
  readonly rowLabel: string
  readonly onNavigateSession: (sessionId: string) => void
}) {
  if (workers.length === 0) return null
  return (
    <fieldset aria-label={`${label} Hive sessions`} className="m-0 min-w-0 border-0 p-0">
      <div className="px-2 pb-0.5 pt-1 text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </div>
      <SessionSummaryPaginatedList
        items={workers}
        getKey={(worker) => worker.id}
        renderItem={(worker) => (
          <HiveSessionRow
            label={rowLabel}
            session={worker}
            onClick={() => onNavigateSession(String(worker.id))}
          />
        )}
      />
    </fieldset>
  )
}

export function HiveSessionRow({
  label,
  session,
  onClick,
}: {
  readonly label: string
  readonly session: HiveSession
  readonly onClick: () => void
}) {
  const status = useSessionStatusStore((store) => store.statuses.get(session.id) ?? 'idle')
  const statusView = resolveSessionStatusPill(status)
  const state = session.lineage?.delegationState ?? null
  const statusLabel = hiveSessionStatusLabel(session, statusView?.shortLabel ?? 'Idle')
  const Icon = session.lineage?.role === 'queen' ? ChessQueen : Pickaxe
  return (
    <Button
      variant="unstyled"
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-bg-hover"
      aria-label={`Open ${session.lineage?.role === 'queen' ? 'Queen' : 'Worker'} Session: ${session.title} · Status: ${statusLabel}`}
      title={`Open ${session.lineage?.role === 'queen' ? 'Queen' : 'Worker'} Session: ${session.title}`}
      onClick={onClick}
    >
      <Icon aria-hidden="true" className="size-3.5 text-text-tertiary" />
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: statusView?.colorVar ?? IDLE_ROW_COLOR_VAR }}
      />
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{session.title}</span>
      <span
        className={
          hiveStateNeedsAttention(state) ? 'text-xs text-warning' : 'text-xs text-text-tertiary'
        }
      >
        {statusLabel}
      </span>
      <ChevronRight aria-hidden="true" className="size-3 text-text-muted" />
    </Button>
  )
}

function hiveSessionStatusLabel(session: HiveSession, fallback: string) {
  const state = session.lineage?.delegationState
  if (session.lineage?.historical) {
    return state ? `Last: ${HIVE_DELEGATION_LABELS[state]}` : 'Historical'
  }
  return state ? HIVE_DELEGATION_LABELS[state] : fallback
}
