import { SessionId } from '@shared/types/brand'
import type {
  SessionDelegationState,
  SessionHiveRelations,
  SessionLineage,
  SessionSummary,
} from '@shared/types/session'
import { useQuery } from '@tanstack/react-query'
import { ChessQueen, ChevronDown, ChevronRight, Pickaxe } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { sessionHiveRelationsQueryOptions } from '@/queries/session-hive-relations'
import { Button } from '@/shared/ui/Button'
import { useSessionSummaryUIStore } from '../state/session-summary-ui-store'
import { SessionSummaryPaginatedList } from './SessionSummaryPrimitives'

const HIVE_COMPLETION_COLLAPSE_DELAY_MS = 2_500

const DELEGATION_LABELS: Readonly<Record<SessionDelegationState, string>> = {
  working: 'Working',
  waiting: 'Waiting',
  needs_attention: 'Needs attention',
  ready_for_review: 'Ready for review',
  revision_requested: 'Revision requested',
  accepted: 'Accepted',
  cancelled: 'Cancelled',
}

function lineageOf(value: SessionSummary | null | undefined): SessionLineage | null {
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

function hiveSummaryModel(relations: SessionHiveRelations | undefined) {
  const current = relations?.current
  const lineage = lineageOf(current)
  if (!current || !lineage || lineage.role === 'independent') return null
  const workers = relations.workers.filter((session) => !session.archived)
  const archivedWorkers = relations.workers.filter((session) => session.archived)
  const attention = workers.some((worker) => needsAttention(lineageOf(worker)))
  return {
    current,
    lineage,
    workers,
    archivedWorkers,
    parent: relations.parent,
    attention,
    defaultExpanded:
      attention ||
      workers.some((worker) => !isDone(lineageOf(worker))) ||
      lineage.role === 'worker',
  }
}

function useHiveExpansion(sessionId: string, shouldExpandAutomatically: boolean) {
  const [expansionOverride, setExpansionOverride] = useState<boolean | null>(() =>
    storedExpansion(sessionId),
  )
  const [automaticExpanded, setAutomaticExpanded] = useState(shouldExpandAutomatically)
  const sectionRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (expansionOverride !== null) return
    if (shouldExpandAutomatically) {
      setAutomaticExpanded(true)
      return
    }
    if (!automaticExpanded) return
    const timeout = window.setTimeout(() => {
      const activeElement = document.activeElement
      if (
        activeElement instanceof HTMLElement &&
        activeElement !== triggerRef.current &&
        sectionRef.current?.contains(activeElement)
      ) {
        triggerRef.current?.focus()
      }
      setAutomaticExpanded(false)
    }, HIVE_COMPLETION_COLLAPSE_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [automaticExpanded, expansionOverride, shouldExpandAutomatically])

  const expanded = expansionOverride ?? (shouldExpandAutomatically || automaticExpanded)
  const toggleExpanded = () => {
    const next = !expanded
    setExpansionOverride(next)
    try {
      localStorage.setItem(expansionKey(sessionId), String(next))
    } catch {
      // Storage failure must not disable Hive navigation.
    }
  }
  return { expanded, sectionRef, toggleExpanded, triggerRef }
}

export function HiveSummarySection({
  sessionId,
  onNavigateSession,
}: {
  readonly sessionId: string
  readonly onNavigateSession: (sessionId: string) => void
}) {
  const relations = useQuery(sessionHiveRelationsQueryOptions(SessionId(sessionId))).data
  const model = hiveSummaryModel(relations)
  const requestToggleFocus = useSessionSummaryUIStore((state) => state.requestToggleFocus)
  const generatedContentId = useId()
  const contentId = `session-summary-hive-${generatedContentId.replaceAll(':', '')}`
  const shouldExpandAutomatically = model?.defaultExpanded ?? false
  const expansion = useHiveExpansion(sessionId, shouldExpandAutomatically)

  if (!model) return null

  function navigateSession(targetSessionId: string) {
    requestToggleFocus(targetSessionId)
    onNavigateSession(targetSessionId)
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
    <section ref={expansion.sectionRef} className="border-t border-border" aria-label="Hive">
      <div className="sticky top-0 z-10 bg-bg-secondary/95 backdrop-blur">
        <Button
          ref={expansion.triggerRef}
          variant="unstyled"
          className="flex h-10 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-bg-hover"
          aria-controls={contentId}
          aria-expanded={expansion.expanded}
          onClick={expansion.toggleExpanded}
        >
          {expansion.expanded ? (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5" />
          )}
          <Icon aria-hidden="true" className="size-3.5 text-accent" />
          <span className="flex-1 text-sm font-medium text-text-primary">Hive</span>
          {totalCount > 0 ? (
            <span
              className={model.attention ? 'text-xs text-warning' : 'text-xs text-text-tertiary'}
            >
              {activeCount} active · {totalCount} total
            </span>
          ) : null}
        </Button>
      </div>
      <div
        id={contentId}
        aria-hidden={!expansion.expanded}
        inert={!expansion.expanded}
        className={
          expansion.expanded
            ? 'grid grid-rows-[1fr] opacity-100 transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none'
            : 'grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none'
        }
      >
        <div className="min-h-0 overflow-hidden">
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
                onClick={() => navigateSession(String(model.parent?.id))}
              />
            ) : null}
            <HiveWorkerGroup
              label="Active"
              workers={activeWorkers}
              rowLabel="Worker"
              onNavigateSession={navigateSession}
            />
            <HiveWorkerGroup
              label="Done"
              workers={doneWorkers}
              rowLabel="Done"
              onNavigateSession={navigateSession}
            />
            <HiveWorkerGroup
              label="Archived"
              workers={model.archivedWorkers}
              rowLabel="Archived"
              onNavigateSession={navigateSession}
            />
          </div>
        </div>
      </div>
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
  readonly workers: readonly SessionSummary[]
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
            title={worker.title}
            state={lineageOf(worker)?.delegationState ?? null}
            onClick={() => onNavigateSession(String(worker.id))}
          />
        )}
      />
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
      <Pickaxe aria-hidden="true" className="size-3.5 text-text-tertiary" />
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
      <ChevronRight aria-hidden="true" className="size-3 text-text-muted" />
    </Button>
  )
}
