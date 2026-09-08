import { SessionId } from '@shared/types/brand'
import { useQueryClient } from '@tanstack/react-query'
import { Image, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useSessionResourceBranchNames } from '../hooks/useSessionResourceBranchNames'
import {
  invalidateSessionResourceQueries,
  sessionResourceThumbnailQueryKey,
  useSessionResource,
  useSessionResourceCatalog,
} from '../hooks/useSessionResources'
import {
  DEFAULT_SESSION_RESOURCE_BROWSER_TARGET,
  groupSessionResources,
  type SessionResourceBrowserTarget,
  type SessionResourceBrowserView,
} from '../model/session-resource-browser'
import { SessionResourcesPanelBody } from './SessionResourcesPanelBody'

const EMPTY_PATH_NODE_IDS: ReadonlySet<string> = new Set()

const FILTERS: readonly { readonly id: SessionResourceBrowserView; readonly label: string }[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'outputs', label: 'Outputs' },
]

function ResourcesPanelHeader({ onClose }: { readonly onClose: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Image className="size-4 text-text-tertiary" />
        <h2 className="truncate text-sm font-semibold text-text-primary">Sources & outputs</h2>
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Close resources" onClick={onClose}>
        <X className="size-4" />
      </Button>
    </header>
  )
}

function ResourceFilters({
  selected,
  onSelect,
}: {
  readonly selected: SessionResourceBrowserView
  readonly onSelect: (view: SessionResourceBrowserView) => void
}) {
  return (
    <nav
      className="flex shrink-0 gap-1 border-b border-border px-3 py-2"
      aria-label="Resource filters"
    >
      {FILTERS.map((item) => (
        <Button
          key={item.id}
          variant={selected === item.id ? 'subtle' : 'ghost'}
          size="xs"
          aria-pressed={selected === item.id}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </Button>
      ))}
    </nav>
  )
}

interface SessionResourcesPanelProps {
  readonly sessionId: string | null
  readonly activeBranchId?: string | null
  readonly activePathNodeIds?: ReadonlySet<string>
  readonly target?: SessionResourceBrowserTarget
  readonly onClose: () => void
  readonly onTargetChange?: (target: SessionResourceBrowserTarget) => void
}

interface BoundSessionResourcesPanelProps {
  readonly sessionId: string | null
  readonly activeBranchId: string | null
  readonly activePathNodeIds: ReadonlySet<string>
  readonly target: SessionResourceBrowserTarget
  readonly onClose: () => void
  readonly onTargetChange?: (target: SessionResourceBrowserTarget) => void
}

function BoundSessionResourcesPanel({
  sessionId,
  activeBranchId,
  target,
  onClose,
  onTargetChange,
  activePathNodeIds,
}: BoundSessionResourcesPanelProps) {
  const [filter, setFilter] = useState<SessionResourceBrowserView>(target.view)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const retryingRef = useRef(false)
  const queryClient = useQueryClient()
  const pathNodeIds = [...activePathNodeIds]
  const query = useSessionResourceCatalog(sessionId, filter, { activeBranchId, pathNodeIds })
  const resources = query.resources
  const targetLoaded = target.resourceId
    ? resources.some((resource) => resource.id === target.resourceId)
    : true
  const exactTarget = useSessionResource(
    sessionId,
    query.isSuccess && !targetLoaded ? (target.resourceId ?? null) : null,
    filter,
    activeBranchId,
    pathNodeIds,
  )
  const branchNames = useSessionResourceBranchNames(sessionId)
  const deepTarget = targetLoaded ? null : exactTarget.data
  // Keep exact links cheap even for very large catalogs. The selected item is appended to the
  // current page instead of mounting every preceding row merely to make it reachable.
  const visibleResources = deepTarget ? [...resources, deepTarget] : resources
  const resourceGroups = groupSessionResources(visibleResources, filter)

  async function retryResource(resourceId: string) {
    if (!sessionId || retryingRef.current) return
    retryingRef.current = true
    setRetryingId(resourceId)
    setRetryError(null)
    try {
      await api.retrySessionResource(SessionId(sessionId), resourceId)
      await queryClient.invalidateQueries({
        queryKey: sessionResourceThumbnailQueryKey(sessionId, resourceId),
      })
      await invalidateSessionResourceQueries(queryClient, sessionId)
    } catch (cause) {
      setRetryError(cause instanceof Error ? cause.message : 'Could not retry this resource.')
    } finally {
      retryingRef.current = false
      setRetryingId(null)
    }
  }

  function selectFilter(view: SessionResourceBrowserView) {
    setFilter(view)
    onTargetChange?.({ view })
  }

  return (
    <section className="flex size-full min-h-0 flex-col bg-diff-bg" aria-label="Session resources">
      <ResourcesPanelHeader onClose={onClose} />
      <ResourceFilters selected={filter} onSelect={selectFilter} />
      <SessionResourcesPanelBody
        model={{
          sessionId,
          target,
          filter,
          loading: query.isLoading || (Boolean(target.resourceId) && exactTarget.isLoading),
          loadingMore: query.isFetchingNextPage,
          failed: query.isError || exactTarget.isError,
          errorMessage: query.error?.message ?? exactTarget.error?.message ?? null,
          retryError,
          retryingId,
          resources,
          total: query.total,
          hasMore: query.hasNextPage,
          visibleResources,
          resourceGroups,
          branchNames,
          activePathNodeIds,
        }}
        onRetryResource={(resourceId) => void retryResource(resourceId)}
        onRetryCatalog={() => {
          void query.refetch()
          void exactTarget.refetch()
        }}
        onShowMore={() => void query.loadNextPage()}
      />
    </section>
  )
}

export function SessionResourcesPanel({
  sessionId,
  activeBranchId = null,
  target = DEFAULT_SESSION_RESOURCE_BROWSER_TARGET,
  onClose,
  onTargetChange,
  activePathNodeIds = EMPTY_PATH_NODE_IDS,
}: SessionResourcesPanelProps) {
  const bindingKey = `${sessionId ?? 'none'}:${activeBranchId ?? 'none'}:${target.view}:${target.resourceId ?? ''}`
  return (
    <BoundSessionResourcesPanel
      key={bindingKey}
      sessionId={sessionId}
      activeBranchId={activeBranchId}
      activePathNodeIds={activePathNodeIds}
      target={target}
      onClose={onClose}
      onTargetChange={onTargetChange}
    />
  )
}
