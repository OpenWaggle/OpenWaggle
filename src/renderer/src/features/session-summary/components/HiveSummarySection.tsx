import { SessionId } from '@shared/types/brand'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChessQueen, ChevronDown, ChevronRight, Pickaxe } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { sessionHiveRelationsQueryOptions } from '@/queries/session-hive-relations'
import { Button } from '@/shared/ui/Button'
import { hiveSummaryModel } from '../model/session-hive-summary'
import { useSessionSummaryUIStore } from '../state/session-summary-ui-store'
import { HiveArchivedWorkers, HiveSessionRow, HiveWorkerGroup } from './HiveSummaryWorkers'

const HIVE_COMPLETION_COLLAPSE_DELAY_MS = 2_500

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
  const query = useInfiniteQuery(sessionHiveRelationsQueryOptions(SessionId(sessionId)))
  const model = hiveSummaryModel(query.data?.pages)
  const requestToggleFocus = useSessionSummaryUIStore((state) => state.requestToggleFocus)
  const generatedContentId = useId()
  const contentId = `session-summary-hive-${generatedContentId.replaceAll(':', '')}`
  const shouldExpandAutomatically = model?.defaultExpanded ?? false
  const expansion = useHiveExpansion(sessionId, shouldExpandAutomatically)

  if (!model)
    return query.isError ? (
      <section aria-label="Hive" className="border-t border-border px-3 py-2">
        <p role="alert" className="text-sm text-text-secondary">
          Unable to load this session's Hive.
        </p>
        <Button variant="unstyled" onClick={() => void query.refetch()}>
          Retry Hive
        </Button>
      </section>
    ) : null

  function navigateSession(targetSessionId: string) {
    requestToggleFocus(targetSessionId)
    onNavigateSession(targetSessionId)
  }

  const { activeWorkers, reviewWorkers, doneWorkers, historicalWorkers } = model
  return (
    <section ref={expansion.sectionRef} className="border-t border-border" aria-label="Hive">
      <HiveSummaryHeader model={model} expansion={expansion} contentId={contentId} />
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
                session={model.parent}
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
              label="Review"
              workers={reviewWorkers}
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
              label="Historical"
              workers={historicalWorkers}
              rowLabel="Past Worker"
              onNavigateSession={navigateSession}
            />
            <HiveArchivedWorkers
              workers={model.archivedWorkers}
              onNavigateSession={navigateSession}
            />
            <HivePageControls
              error={query.isError}
              loading={query.isFetching}
              hasMore={query.hasNextPage}
              onLoad={() =>
                void (query.isFetchNextPageError || !query.isError
                  ? query.fetchNextPage()
                  : query.refetch())
              }
            />
          </div>
        </div>
      </div>
    </section>
  )
}

function HiveSummaryHeader({
  model,
  expansion,
  contentId,
}: {
  readonly model: NonNullable<ReturnType<typeof hiveSummaryModel>>
  readonly expansion: ReturnType<typeof useHiveExpansion>
  readonly contentId: string
}) {
  const Icon = model.lineage.role === 'queen' ? ChessQueen : Pickaxe
  return (
    <div className="sticky top-0 z-10 flex h-10 items-center gap-2 bg-bg-secondary/95 px-3 backdrop-blur">
      <Icon aria-hidden="true" className="size-3.5 text-accent" />
      <span className="flex-1 text-sm font-medium text-text-primary">Hive</span>
      {model.totalCount > 0 ? (
        <span className={model.attention ? 'text-xs text-warning' : 'text-xs text-text-tertiary'}>
          {model.activeCount} active · {model.totalCount} total
        </span>
      ) : null}
      <Button
        ref={expansion.triggerRef}
        variant="unstyled"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
        aria-label={expansion.expanded ? 'Collapse Hive' : 'Expand Hive'}
        aria-controls={contentId}
        aria-expanded={expansion.expanded}
        onClick={expansion.toggleExpanded}
      >
        {expansion.expanded ? (
          <ChevronDown aria-hidden="true" className="size-3.5" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3.5" />
        )}
      </Button>
    </div>
  )
}

function HivePageControls({
  error,
  loading,
  hasMore,
  onLoad,
}: {
  readonly error: boolean
  readonly loading: boolean
  readonly hasMore: boolean
  readonly onLoad: () => void
}) {
  if (!hasMore && !error) return null
  return (
    <>
      {error ? <p role="alert">Unable to load more workers.</p> : null}
      <Button
        variant="unstyled"
        className="px-2 py-1 text-sm text-text-secondary"
        disabled={loading}
        onClick={onLoad}
      >
        {error ? 'Retry Hive' : 'Load more workers'}
      </Button>
    </>
  )
}
