import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { useQueryClient } from '@tanstack/react-query'
import { Image, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useSessionResourceBranchNames } from '../hooks/useSessionResourceBranchNames'
import { sessionResourceThumbnailQueryKey, useSessionResources } from '../hooks/useSessionResources'
import {
  DEFAULT_SESSION_RESOURCE_BROWSER_TARGET,
  groupSessionResources,
  type SessionResourceBrowserTarget,
  type SessionResourceBrowserView,
} from '../model/session-resource-browser'
import { SessionResourcesPanelBody } from './SessionResourcesPanelBody'

const RESOURCE_PAGE_SIZE = 40

function filteredResources(
  resources: readonly SessionResource[],
  view: SessionResourceBrowserView,
) {
  return view === 'sources'
    ? resources.filter((resource) => resource.isSource)
    : resources.filter((resource) => resource.isOutput)
}

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
  readonly target?: SessionResourceBrowserTarget
  readonly onClose: () => void
  readonly onTargetChange?: (target: SessionResourceBrowserTarget) => void
}

interface BoundSessionResourcesPanelProps {
  readonly sessionId: string | null
  readonly target: SessionResourceBrowserTarget
  readonly onClose: () => void
  readonly onTargetChange?: (target: SessionResourceBrowserTarget) => void
}

function BoundSessionResourcesPanel({
  sessionId,
  target,
  onClose,
  onTargetChange,
}: BoundSessionResourcesPanelProps) {
  const [filter, setFilter] = useState<SessionResourceBrowserView>(target.view)
  const [visibleCount, setVisibleCount] = useState(RESOURCE_PAGE_SIZE)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const retryingRef = useRef(false)
  const queryClient = useQueryClient()
  const query = useSessionResources(sessionId)
  const branchNames = useSessionResourceBranchNames(sessionId)
  const resources = filteredResources(query.data ?? [], filter)
  const targetIndex = target.resourceId
    ? resources.findIndex((resource) => resource.id === target.resourceId)
    : -1
  const effectiveVisibleCount = Math.max(visibleCount, targetIndex + 1)
  const visibleResources = resources.slice(0, effectiveVisibleCount)
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
      await query.refetch()
    } catch (cause) {
      setRetryError(cause instanceof Error ? cause.message : 'Could not retry this resource.')
    } finally {
      retryingRef.current = false
      setRetryingId(null)
    }
  }

  function selectFilter(view: SessionResourceBrowserView) {
    setFilter(view)
    setVisibleCount(RESOURCE_PAGE_SIZE)
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
          loading: query.isLoading,
          failed: query.isError,
          errorMessage: query.error?.message ?? null,
          retryError,
          retryingId,
          resources,
          visibleResources,
          resourceGroups,
          branchNames,
        }}
        onRetryResource={(resourceId) => void retryResource(resourceId)}
        onRetryCatalog={() => void query.refetch()}
        onShowMore={() => setVisibleCount((count) => count + RESOURCE_PAGE_SIZE)}
      />
    </section>
  )
}

export function SessionResourcesPanel({
  sessionId,
  target = DEFAULT_SESSION_RESOURCE_BROWSER_TARGET,
  onClose,
  onTargetChange,
}: SessionResourcesPanelProps) {
  const bindingKey = `${sessionId ?? 'none'}:${target.view}:${target.resourceId ?? ''}`
  return (
    <BoundSessionResourcesPanel
      key={bindingKey}
      sessionId={sessionId}
      target={target}
      onClose={onClose}
      onTargetChange={onTargetChange}
    />
  )
}
