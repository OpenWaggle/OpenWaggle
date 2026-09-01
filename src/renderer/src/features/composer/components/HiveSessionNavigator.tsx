import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { ChessQueen, ChevronDown, ChevronRight, Pickaxe } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSessionStore } from '@/features/sessions/state'
import { Button } from '@/shared/ui/Button'
import { HiveSessionWorkerGroups } from './HiveSessionWorkerGroups'
import { storedHiveExpansion, storeHiveExpansion } from './hive-session-expansion'

interface HiveSessionNavigatorProps {
  readonly sessionId: SessionId | null
  readonly onNavigateSession: (sessionId: SessionId) => void
}

/** Compact, reciprocal navigation for the active Session's immediate Hive relationships. */
export function HiveSessionNavigator({ sessionId, onNavigateSession }: HiveSessionNavigatorProps) {
  const activeSessions = useSessionStore((state) => state.sessions)
  const archivedSessions = useSessionStore((state) => state.archivedSessions)
  const hiveSessions = useSessionStore((state) => state.hiveSessions)
  const hiveContextSessionId = useSessionStore((state) => state.hiveContextSessionId)
  const hiveWorkersNextCursor = useSessionStore((state) => state.hiveWorkersNextCursor)
  const loadHiveSessions = useSessionStore((state) => state.loadHiveSessions)
  const loadMoreHiveSessions = useSessionStore((state) => state.loadMoreHiveSessions)
  const sessions = [...hiveSessions, ...activeSessions, ...archivedSessions].filter(
    (session, index, all) => all.findIndex((candidate) => candidate.id === session.id) === index,
  )
  const selectedSession = sessionId
    ? sessions.find((session) => session.id === sessionId)
    : undefined
  const [expansionOverrides, setExpansionOverrides] = useState<Readonly<Record<string, boolean>>>(
    {},
  )
  useEffect(() => {
    if (sessionId && hiveContextSessionId !== sessionId) void loadHiveSessions(sessionId)
  }, [hiveContextSessionId, loadHiveSessions, sessionId])
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
        <HiveSessionWorkerGroups
          parent={current.lineage.role === 'worker' ? parent : undefined}
          workers={workers}
          onNavigateSession={onNavigateSession}
          hasMoreWorkers={hiveWorkersNextCursor !== null}
          onLoadMoreWorkers={() => void loadMoreHiveSessions(activeSessionId)}
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
