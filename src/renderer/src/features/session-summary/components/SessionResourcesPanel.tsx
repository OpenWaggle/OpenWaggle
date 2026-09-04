import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Image, LoaderCircle, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { sessionResourceThumbnailQueryKey, useSessionResources } from '../hooks/useSessionResources'
import {
  DEFAULT_SESSION_RESOURCE_BROWSER_TARGET,
  groupSessionResources,
  type SessionResourceBrowserTarget,
  type SessionResourceBrowserView,
} from '../model/session-resource-browser'
import { SessionResourceRow } from './SessionResourceRow'

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
  const queryClient = useQueryClient()
  const query = useSessionResources(sessionId)
  const resources = filteredResources(query.data ?? [], filter)
  const targetIndex = target.resourceId
    ? resources.findIndex((resource) => resource.id === target.resourceId)
    : -1
  const effectiveVisibleCount = Math.max(visibleCount, targetIndex + 1)
  const visibleResources = resources.slice(0, effectiveVisibleCount)
  const resourceGroups = groupSessionResources(visibleResources, filter)

  async function retryResource(resourceId: string) {
    if (!sessionId) return
    await api.retrySessionResource(SessionId(sessionId), resourceId)
    await queryClient.invalidateQueries({
      queryKey: sessionResourceThumbnailQueryKey(sessionId, resourceId),
    })
    await query.refetch()
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
      <div
        className={cn(
          'min-h-0 flex-1 space-y-2 overflow-y-auto p-3',
          query.isLoading && 'opacity-60',
        )}
      >
        {query.isLoading ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-text-tertiary"
          >
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            Loading this session’s sources and outputs…
          </div>
        ) : null}
        {query.isError ? (
          <div
            role="alert"
            className="mx-1 flex flex-col items-center rounded-lg border border-border bg-bg-secondary px-5 py-8 text-center"
          >
            <CircleAlert className="mb-3 size-5 text-warning" aria-hidden="true" />
            <p className="text-sm font-medium text-text-primary">
              Couldn’t load this session’s sources and outputs.
            </p>
            <p className="mt-1 text-xs text-text-tertiary">{query.error.message}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              aria-label="Retry loading resources"
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {!query.isError &&
          resourceGroups.map((group) => (
            <section key={group.id} aria-labelledby={`session-resource-group-${group.id}`}>
              <h3
                id={`session-resource-group-${group.id}`}
                className="mb-1.5 flex items-center justify-between px-1 text-xs font-medium text-text-tertiary"
              >
                <span>{group.label}</span>
                <span className="tabular-nums" aria-hidden="true">
                  {group.resources.length}
                </span>
              </h3>
              <div className="space-y-2">
                {group.resources.map((resource) => (
                  <SessionResourceRow
                    key={resource.id}
                    resource={resource}
                    sessionId={sessionId ?? ''}
                    onRetry={() => void retryResource(resource.id)}
                    selected={resource.id === target.resourceId}
                    view={filter}
                  />
                ))}
              </div>
            </section>
          ))}
        {!query.isError && visibleResources.length < resources.length ? (
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setVisibleCount((count) => count + RESOURCE_PAGE_SIZE)}
          >
            Show more ({resources.length - visibleResources.length})
          </Button>
        ) : null}
        {!query.isLoading && !query.isError && resources.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-text-tertiary">
            No resources in this view.
          </p>
        ) : null}
      </div>
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
