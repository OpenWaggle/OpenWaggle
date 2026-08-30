import { isMatching, P } from '@diegogbrisa/ts-match'
import { isRecord } from '@shared/utils/validation'
import { ChessQueen, ChevronDown, ChevronRight, Pickaxe } from 'lucide-react'
import { useState } from 'react'
import { useSessionStore } from '@/features/sessions/state'
import { Button } from '@/shared/ui/Button'

type HiveRole = 'queen' | 'worker' | 'independent'
type DelegationState =
  | 'working'
  | 'waiting'
  | 'needs_attention'
  | 'ready_for_review'
  | 'revision_requested'
  | 'accepted'
  | 'cancelled'

interface HiveLineage {
  readonly role: HiveRole
  readonly parentSessionId: string | null
  readonly directWorkerCount: number
  readonly activeDirectWorkerCount: number
  readonly agentDefinitionName: string | null
  readonly delegationState: DelegationState | null
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

function lineageOf(value: unknown): HiveLineage | null {
  if (!isRecord(value) || !isRecord(value.lineage)) return null
  const lineage = value.lineage
  if (lineage.role !== 'queen' && lineage.role !== 'worker' && lineage.role !== 'independent') {
    return null
  }
  const delegationState = isMatching(
    P.union(
      'working',
      'waiting',
      'needs_attention',
      'ready_for_review',
      'revision_requested',
      'accepted',
      'cancelled',
    ),
    lineage.delegationState,
  )
    ? lineage.delegationState
    : null
  return {
    role: lineage.role,
    parentSessionId: typeof lineage.parentSessionId === 'string' ? lineage.parentSessionId : null,
    directWorkerCount:
      typeof lineage.directWorkerCount === 'number' ? lineage.directWorkerCount : 0,
    activeDirectWorkerCount:
      typeof lineage.activeDirectWorkerCount === 'number' ? lineage.activeDirectWorkerCount : 0,
    agentDefinitionName:
      typeof lineage.agentDefinitionName === 'string' ? lineage.agentDefinitionName : null,
    delegationState,
  }
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

function isDone(lineage: HiveLineage | null) {
  return lineage?.delegationState === 'accepted' || lineage?.delegationState === 'cancelled'
}

function needsAttention(lineage: HiveLineage | null) {
  return stateNeedsAttention(lineage?.delegationState ?? null)
}

function stateNeedsAttention(state: DelegationState | null) {
  return state === 'needs_attention' || state === 'revision_requested'
}

function hiveSummaryModel(
  sessions: ReturnType<typeof useSessionStore.getState>['sessions'],
  sessionId: string,
) {
  const current = sessions.find((session) => String(session.id) === sessionId)
  const lineage = lineageOf(current)
  if (!current || !lineage || lineage.role === 'independent') return null
  const workers = sessions.filter((session) => lineageOf(session)?.parentSessionId === sessionId)
  const parent = lineage.parentSessionId
    ? sessions.find((session) => String(session.id) === lineage.parentSessionId)
    : undefined
  const attention = workers.some((worker) => needsAttention(lineageOf(worker)))
  return {
    current,
    lineage,
    workers,
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
  const model = hiveSummaryModel(sessions, sessionId)
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
        {model.lineage.directWorkerCount > 0 ? (
          <span className={model.attention ? 'text-xs text-warning' : 'text-xs text-text-tertiary'}>
            {model.lineage.activeDirectWorkerCount} active · {model.lineage.directWorkerCount} total
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
          {model.workers.map((worker) => (
            <HiveSessionRow
              key={worker.id}
              label={isDone(lineageOf(worker)) ? 'Done' : 'Worker'}
              title={worker.title}
              state={lineageOf(worker)?.delegationState ?? null}
              onClick={() => onNavigateSession(String(worker.id))}
            />
          ))}
        </div>
      ) : null}
    </section>
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
  readonly state: DelegationState | null
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
