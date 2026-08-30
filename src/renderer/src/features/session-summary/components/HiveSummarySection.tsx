import type { SessionDelegationState, SessionLineage, SessionSummary } from '@shared/types/session'
import { useQuery } from '@tanstack/react-query'
import { ChessQueen, ChevronDown, ChevronRight, Pickaxe } from 'lucide-react'
import { useState } from 'react'
import { useSessionStore } from '@/features/sessions/state'
import { archivedSessionsQueryOptions } from '@/queries/archived-sessions'
import { Button } from '@/shared/ui/Button'

const DELEGATION_LABELS: Readonly<Record<SessionDelegationState, string>> = {
  working: 'Working',
  waiting: 'Waiting',
  needs_attention: 'Needs attention',
  ready_for_review: 'Ready for review',
  revision_requested: 'Revision requested',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
}

function lineageOf(value: SessionSummary | undefined): SessionLineage | null {
  return value?.lineage ?? null
}

function expansionKey(sessionId: string) {
  return `openwaggle:session-summary:${sessionId}:hive`
}

function storedExpansion(sessionId: string) {
  try {
    const stored = localStorage.getItem(expansionKey(sessionId))
    return stored === null ? null : stored === 'true'
  } catch {
    return null
  }
}

function isDone(lineage: SessionLineage | null) {
  return lineage?.delegationState === 'accepted' || lineage?.delegationState === 'cancelled'
}

function needsAttention(lineage: SessionLineage | null) {
  return stateNeedsAttention(lineage?.delegationState ?? null)
}

function stateNeedsAttention(state: SessionDelegationState | null) {
  return state === 'needs_attention' || state === 'revision_requested'
}

function hiveSummaryModel(
  sessions: ReturnType<typeof useSessionStore.getState>['sessions'],
  archivedSessions: ReturnType<typeof useSessionStore.getState>['sessions'],
  sessionId: string,
) {
  const current = sessions.find((session) => String(session.id) === sessionId)
  const lineage = lineageOf(current)
  if (!current || !lineage || lineage.role === 'independent') return null
  const workers = sessions.filter((session) => lineageOf(session)?.parentSessionId === sessionId)
  const liveIds = new Set(sessions.map((session) => String(session.id)))
  const archivedWorkers = archivedSessions.filter(
    (session) =>
      !liveIds.has(String(session.id)) && lineageOf(session)?.parentSessionId === sessionId,
  )
  const parent = lineage.parentSessionId
    ? (sessions.find((session) => String(session.id) === lineage.parentSessionId) ??
      archivedSessions.find((session) => String(session.id) === lineage.parentSessionId))
    : undefined
  const attention = workers.some((worker) => needsAttention(lineageOf(worker)))
  return {
    current,
    lineage,
    workers,
    archivedWorkers,
    parent,
    attention,
    defaultExpanded:
      attention ||
      workers.some((worker) => !isDone(lineageOf(worker))) ||
      lineage.role === 'worker',
  }
}

export function HiveSummarySection({
  sessionId,
  onNavigateSession,
}: {
  readonly sessionId: string
  readonly onNavigateSession: (sessionId: string) => void
}) {
  const sessions = useSessionStore((state) => state.sessions)
  const archivedSessions = useQuery(archivedSessionsQueryOptions()).data ?? []
  const model = hiveSummaryModel(sessions, archivedSessions, sessionId)
  const [expanded, setExpanded] = useState(
    () => storedExpansion(sessionId) ?? model?.defaultExpanded ?? false,
  )

  if (!model) return null

  function toggleExpanded() {
    const next = !expanded
    setExpanded(next)
    try {
      localStorage.setItem(expansionKey(sessionId), String(next))
    } catch {
      // Storage failure must not disable Hive navigation.
    }
  }

  const Icon = model.lineage.role === 'queen' ? ChessQueen : Pickaxe
  const activeWorkers = model.workers.filter((worker) => !isDone(lineageOf(worker)))
  const doneWorkers = model.workers.filter((worker) => isDone(lineageOf(worker)))
  const activeCount = Math.max(model.lineage.activeDirectWorkerCount, activeWorkers.length)
  const totalCount = Math.max(
    model.lineage.directWorkerCount,
    model.workers.length + model.archivedWorkers.length,
  )
  return (
    <section className="border-t border-border" aria-label="Hive">
      <Button
        variant="unstyled"
        className="flex h-10 w-full items-center gap-2 px-3 text-left hover:bg-bg-hover"
        aria-expanded={expanded}
        onClick={toggleExpanded}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Icon className="size-3.5 text-accent" />
        <span className="flex-1 text-sm font-medium text-text-primary">Hive</span>
        {totalCount > 0 ? (
          <span className={model.attention ? 'text-xs text-warning' : 'text-xs text-text-tertiary'}>
            {activeCount} active · {totalCount} total
          </span>
        ) : null}
      </Button>
      {expanded ? (
        <div className="space-y-1 px-2 pb-2">
          {model.lineage.agentDefinitionName ? (
            <div className="truncate px-2 text-xs text-text-tertiary">
              {model.lineage.agentDefinitionName}
            </div>
          ) : null}
          {model.parent ? (
            <HiveSessionRow
              label="Parent"
              title={model.parent.title}
              state={lineageOf(model.parent)?.delegationState ?? null}
              onClick={() => onNavigateSession(String(model.parent?.id))}
            />
          ) : null}
          <HiveWorkerGroup
            label="Active"
            workers={activeWorkers}
            rowLabel="Worker"
            onNavigateSession={onNavigateSession}
          />
          <HiveWorkerGroup
            label="Done"
            workers={doneWorkers}
            rowLabel="Done"
            onNavigateSession={onNavigateSession}
          />
          <HiveWorkerGroup
            label="Archived"
            workers={model.archivedWorkers}
            rowLabel="Archived"
            onNavigateSession={onNavigateSession}
          />
        </div>
      ) : null}
    </section>
  )
}

function HiveWorkerGroup({
  label,
  workers,
  rowLabel,
  onNavigateSession,
}: {
  readonly label: string
  readonly workers: ReturnType<typeof useSessionStore.getState>['sessions']
  readonly rowLabel: string
  readonly onNavigateSession: (sessionId: string) => void
}) {
  if (workers.length === 0) return null
  return (
    <fieldset aria-label={`${label} Hive sessions`} className="m-0 min-w-0 border-0 p-0">
      <div className="px-2 pb-0.5 pt-1 text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </div>
      {workers.map((worker) => (
        <HiveSessionRow
          key={worker.id}
          label={rowLabel}
          title={worker.title}
          state={lineageOf(worker)?.delegationState ?? null}
          onClick={() => onNavigateSession(String(worker.id))}
        />
      ))}
    </fieldset>
  )
}

function HiveSessionRow({
  label,
  title,
  state,
  onClick,
}: {
  readonly label: string
  readonly title: string
  readonly state: SessionDelegationState | null
  readonly onClick: () => void
}) {
  return (
    <Button
      variant="unstyled"
      className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-bg-hover"
      onClick={onClick}
    >
      <Pickaxe className="size-3.5 text-text-tertiary" />
      <span className="text-xs text-text-tertiary">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{title}</span>
      {state ? (
        <span
          className={
            stateNeedsAttention(state) ? 'text-xs text-warning' : 'text-xs text-text-tertiary'
          }
        >
          {DELEGATION_LABELS[state]}
        </span>
      ) : null}
      <ChevronRight className="size-3 text-text-muted" />
    </Button>
  )
}
