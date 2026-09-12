import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { HiveSessionNavigationRow, isDoneWorker } from './HiveSessionNavigationRow'

export function HiveSessionWorkerGroups({
  parent,
  workers,
  onNavigateSession,
  hasMoreWorkers,
  onLoadMoreWorkers,
}: {
  readonly parent: SessionSummary | undefined
  readonly workers: readonly SessionSummary[]
  readonly onNavigateSession: (sessionId: SessionId) => void
  readonly hasMoreWorkers: boolean
  readonly onLoadMoreWorkers: () => void
}) {
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const visibleWorkers = workers.filter((worker) => !worker.archived)
  const archivedWorkers = workers.filter((worker) => worker.archived)
  const activeWorkers = visibleWorkers.filter((worker) => !isDoneWorker(worker))
  const doneWorkers = visibleWorkers.filter(isDoneWorker)
  return (
    <div className="mt-0.5 flex flex-col gap-0.5 border-t border-border pt-1">
      {parent ? (
        <HiveSessionNavigationRow
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
      {hasMoreWorkers ? (
        <Button
          variant="unstyled"
          type="button"
          onClick={onLoadMoreWorkers}
          className="min-h-8 rounded-md px-2 text-left text-xs font-medium text-accent hover:bg-bg-hover"
        >
          Load more Workers
        </Button>
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
            <HiveSessionNavigationRow
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
        <HiveSessionNavigationRow
          key={worker.id}
          session={worker}
          lineageRole="worker"
          onNavigateSession={onNavigateSession}
        />
      ))}
    </div>
  )
}
