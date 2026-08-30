import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import type { DelegationState } from '@shared/types/session-collaboration'
import { IDLE_ROW_COLOR_VAR, resolveSessionStatusPill } from '@shared/types/session-status'
import { ChessQueen, ChevronDown, ChevronRight, Pickaxe } from 'lucide-react'
import { useState } from 'react'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { Button } from '@/shared/ui/Button'
import { storedHiveExpansion, storeHiveExpansion } from './hive-session-expansion'

interface HiveSessionNavigatorProps {
  readonly sessionId: SessionId | null
  readonly onNavigateSession: (sessionId: SessionId) => void
}

const DELEGATION_LABELS: Readonly<Record<DelegationState, string>> = {
  working: 'Working',
  waiting: 'Waiting',
  needs_attention: 'Needs attention',
  ready_for_review: 'Ready for review',
  revision_requested: 'Revision requested',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
}

function isDoneWorker(session: SessionSummary) {
  const state = session.lineage?.delegationState
  return state === 'accepted' || state === 'cancelled'
}

function SessionNavigationRow({
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
      aria-label={`Open ${lineageRole === 'queen' ? 'Queen' : 'Worker'} Session: ${session.title}`}
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

/** Compact, reciprocal navigation for the active Session's immediate Hive relationships. */
export function HiveSessionNavigator({ sessionId, onNavigateSession }: HiveSessionNavigatorProps) {
  const activeSessions = useSessionStore((state) => state.sessions)
  const archivedSessions = useSessionStore((state) => state.archivedSessions)
  const sessions = [...activeSessions, ...archivedSessions]
  const selectedSession = sessionId
    ? sessions.find((session) => session.id === sessionId)
    : undefined
  const [expansionOverrides, setExpansionOverrides] = useState<Readonly<Record<string, boolean>>>(
    {},
  )
  if (!sessionId) return null
  const activeSessionId = sessionId

  const current = selectedSession
  if (!current?.lineage || current.lineage.role === 'independent') return null
  const explicitlyExpanded =
    expansionOverrides[activeSessionId] ?? storedHiveExpansion(activeSessionId)
  const expanded =
    explicitlyExpanded ??
    !(current.lineage.role === 'worker' && current.lineage.directWorkerCount === 0)

  const parent = current.lineage.parentSessionId
    ? sessions.find((session) => session.id === current.lineage?.parentSessionId)
    : undefined
  const workers = sessions.filter((session) => session.lineage?.parentSessionId === activeSessionId)
  function toggleExpanded() {
    const next = !expanded
    setExpansionOverrides((currentOverrides) => ({
      ...currentOverrides,
      [activeSessionId]: next,
    }))
    storeHiveExpansion(activeSessionId, next)
  }

  return (
    <section
      aria-label="Hive Sessions"
      className="mx-3.5 rounded-t-xl border-x border-t border-border-light bg-bg-secondary px-2.5 pt-1.5 pb-1"
    >
      <HiveNavigatorHeader
        lineage={current.lineage}
        parent={parent}
        expanded={expanded}
        onToggle={toggleExpanded}
        onNavigateSession={onNavigateSession}
      />

      {expanded ? (
        <HiveWorkerGroups
          parent={current.lineage.role === 'worker' ? parent : undefined}
          workers={workers}
          onNavigateSession={onNavigateSession}
        />
      ) : null}
    </section>
  )
}

function HiveNavigatorHeader({
  lineage,
  parent,
  expanded,
  onToggle,
  onNavigateSession,
}: {
  readonly lineage: NonNullable<SessionSummary['lineage']>
  readonly parent: SessionSummary | undefined
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly onNavigateSession: (sessionId: SessionId) => void
}) {
  return (
    <div className="flex min-h-10 items-center gap-1.5 px-2">
      {lineage.role === 'queen' ? (
        <ChessQueen className="size-3.5 text-accent" />
      ) : (
        <Pickaxe className="size-3.5 text-accent" />
      )}
      <span className="text-xs font-semibold text-text-secondary">Hive</span>
      {lineage.agentDefinitionName ? (
        <>
          <span className="text-xs text-border-strong">·</span>
          <span className="max-w-28 truncate text-xs text-text-tertiary">
            {lineage.agentDefinitionName}
          </span>
        </>
      ) : null}
      {parent ? (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => onNavigateSession(parent.id)}
          aria-label={`Open parent Session: ${parent.title}`}
          title={`Parent Session: ${parent.title}`}
          className="ml-auto flex min-w-0 max-w-48 items-center gap-1 rounded px-1.5 py-1 text-xs text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
        >
          <span className="shrink-0">Parent</span>
          <span className="truncate font-medium text-text-secondary">{parent.title}</span>
        </Button>
      ) : null}
      {parent ? null : <span className="flex-1" />}
      {lineage.directWorkerCount > 0 ? (
        <span className="shrink-0 text-xs text-text-tertiary">
          {lineage.activeDirectWorkerCount} active · {lineage.directWorkerCount} total
        </span>
      ) : null}
      <Button
        variant="unstyled"
        type="button"
        onClick={onToggle}
        aria-label={expanded ? 'Collapse Hive Sessions' : 'Expand Hive Sessions'}
        aria-expanded={expanded}
        title={expanded ? 'Collapse Hive Sessions' : 'Expand Hive Sessions'}
        className="flex size-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
      </Button>
    </div>
  )
}

function HiveWorkerGroups({
  parent,
  workers,
  onNavigateSession,
}: {
  readonly parent: SessionSummary | undefined
  readonly workers: readonly SessionSummary[]
  readonly onNavigateSession: (sessionId: SessionId) => void
}) {
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const visibleWorkers = workers.filter((worker) => !worker.archived)
  const archivedWorkers = workers.filter((worker) => worker.archived)
  const activeWorkers = visibleWorkers.filter((worker) => !isDoneWorker(worker))
  const doneWorkers = visibleWorkers.filter(isDoneWorker)
  return (
    <div className="mt-0.5 flex flex-col gap-0.5 border-t border-border pt-1">
      {parent ? (
        <SessionNavigationRow
          session={parent}
          lineageRole={parent.lineage?.role === 'queen' ? 'queen' : 'worker'}
          onNavigateSession={onNavigateSession}
        />
      ) : null}
      {activeWorkers.length > 0 ? (
        <WorkerGroup label="Active" workers={activeWorkers} onNavigateSession={onNavigateSession} />
      ) : null}
      {doneWorkers.length > 0 ? (
        <WorkerGroup label="Done" workers={doneWorkers} onNavigateSession={onNavigateSession} />
      ) : null}
      {archivedWorkers.length > 0 ? (
        <ArchivedWorkerGroup
          workers={archivedWorkers}
          expanded={archivedExpanded}
          onToggle={() => setArchivedExpanded((current) => !current)}
          onNavigateSession={onNavigateSession}
        />
      ) : null}
    </div>
  )
}

function ArchivedWorkerGroup({
  workers,
  expanded,
  onToggle,
  onNavigateSession,
}: {
  readonly workers: readonly SessionSummary[]
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly onNavigateSession: (sessionId: SessionId) => void
}) {
  const activeCount = workers.filter((worker) => !isDoneWorker(worker)).length
  const needsAttention = workers.some((worker) => {
    const state = worker.lineage?.delegationState
    return state === 'needs_attention' || state === 'revision_requested'
  })
  return (
    <div>
      <Button
        variant="unstyled"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse archived Workers' : 'Expand archived Workers'}
        className="flex min-h-7 items-center gap-1 rounded px-2 text-xs font-medium text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className={needsAttention ? 'text-warning' : undefined}>
          Archived · {workers.length}
        </span>
        {activeCount > 0 ? <span>· {activeCount} active</span> : null}
      </Button>
      {expanded
        ? workers.map((worker) => (
            <SessionNavigationRow
              key={worker.id}
              session={worker}
              lineageRole="worker"
              onNavigateSession={onNavigateSession}
            />
          ))
        : null}
    </div>
  )
}

function WorkerGroup({
  label,
  workers,
  onNavigateSession,
}: {
  readonly label: string
  readonly workers: readonly SessionSummary[]
  readonly onNavigateSession: (sessionId: SessionId) => void
}) {
  return (
    <div>
      <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-text-muted">{label}</div>
      {workers.map((worker) => (
        <SessionNavigationRow
          key={worker.id}
          session={worker}
          lineageRole="worker"
          onNavigateSession={onNavigateSession}
        />
      ))}
    </div>
  )
}
