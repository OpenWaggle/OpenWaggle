import { match } from '@diegogbrisa/ts-match'
import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, File, FolderSearch, Image, Link2, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { sessionResourceThumbnailQueryKey, useSessionResources } from '../hooks/useSessionResources'
import { SessionResourcePreview } from './SessionResourcePreview'
import { SessionResourcesCatalogFailure } from './SessionResourcesCatalogFailure'

export type SessionResourceFilter = 'all' | 'sources' | 'outputs' | 'images'
const RESOURCE_PAGE_SIZE = 40
const LOCAL_RESOURCE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u

function originalResourcePath(resource: SessionResource) {
  return resource.locator && LOCAL_RESOURCE_PATH.test(resource.locator) ? resource.locator : null
}

function filteredResources(resources: readonly SessionResource[], filter: SessionResourceFilter) {
  const filtered = match(filter)
    .with('all', () => resources)
    .with('sources', () => resources.filter((resource) => resource.isSource))
    .with('outputs', () => resources.filter((resource) => resource.isOutput))
    .with('images', () => resources.filter((resource) => resource.kind === 'image'))
    .exhaustive()
  const groups = ['Attachments', 'Links and providers', 'Tool use', 'Web search', 'Outputs']
  return [...filtered].sort(
    (left, right) =>
      groups.indexOf(resourceGroupLabel(left)) - groups.indexOf(resourceGroupLabel(right)) ||
      right.updatedAt - left.updatedAt,
  )
}

function ResourceIcon({ resource }: { readonly resource: SessionResource }) {
  if (resource.kind === 'image') return <Image className="size-4" />
  if (resource.kind === 'link' || resource.kind === 'site') return <Link2 className="size-4" />
  return <File className="size-4" />
}

function resourceStatusLabel(resource: SessionResource, originalPath: string | null) {
  if (!resource.available) return 'Unavailable'
  if (resource.managed && originalPath) return 'Managed copy · Original available'
  const role =
    resource.isSource && resource.isOutput
      ? 'Source and output'
      : resource.isOutput
        ? 'Output'
        : 'Source'
  const occurrence = resource.occurrences.at(-1)
  return occurrence ? `${role} · ${occurrence.actor} ${occurrence.activity}` : role
}

function resourceGroupLabel(resource: SessionResource) {
  if (resource.isOutput && !resource.isSource) return 'Outputs'
  if (resource.kind === 'web-search') return 'Web search'
  if (resource.kind === 'tool') return 'Tool use'
  if (resource.kind === 'link' || resource.kind === 'site') return 'Links and providers'
  return 'Attachments'
}

async function openSessionResource(
  resource: SessionResource,
  sessionId: string,
  originalPath: string | null,
  openViewer: (sessionId: string, resourceId: string) => void,
) {
  if (!resource.available && originalPath) return api.openPath(originalPath)
  if (resource.kind === 'image' && resource.locator?.startsWith('http://')) {
    return api.openExternal(resource.locator)
  }
  if (resource.kind === 'image') return openViewer(sessionId, resource.id)
  if (resource.locator?.startsWith('http')) return api.openExternal(resource.locator)
  if (resource.managed) {
    const content = await api.readSessionResource(SessionId(sessionId), resource.id)
    if (!content) return
    const anchor = document.createElement('a')
    anchor.href = `data:${content.mimeType};base64,${content.dataBase64}`
    anchor.download = content.fileName
    anchor.click()
    return
  }
  if (originalPath) await api.openPath(originalPath)
}

function resourceIsActionable(resource: SessionResource, originalPath: string | null) {
  return (
    originalPath !== null ||
    (resource.kind === 'image' && resource.available) ||
    (resource.managed && resource.available) ||
    resource.locator?.startsWith('http') === true ||
    (resource.available && resource.locator?.startsWith('session-resource://') === true)
  )
}

function resourceCanRetry(resource: SessionResource) {
  return !resource.available && !resource.canonicalKey.startsWith('unavailable-image:')
}

function ResourceRow({
  resource,
  sessionId,
  retrying,
  onRetry,
}: {
  readonly resource: SessionResource
  readonly sessionId: string
  readonly retrying: boolean
  readonly onRetry: () => void
}) {
  const openViewer = useUIStore((state) => state.openResourceViewer)
  const originalPath = originalResourcePath(resource)
  const statusLabel = resourceStatusLabel(resource, originalPath)
  const actionable = resourceIsActionable(resource, originalPath)

  return (
    <div className="group flex w-full items-center rounded-lg border border-border bg-bg transition-colors hover:bg-bg-hover">
      <Button
        variant="unstyled"
        className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left"
        disabled={!actionable}
        onClick={() => void openSessionResource(resource, sessionId, originalPath, openViewer)}
      >
        <span className="size-11 shrink-0 overflow-hidden rounded-md border border-border text-text-tertiary">
          {resource.kind === 'image' ? (
            <SessionResourcePreview resource={resource} sessionId={sessionId} />
          ) : (
            <span className="flex size-full items-center justify-center">
              <ResourceIcon resource={resource} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text-primary">
            {resource.title}
          </span>
          <span className="block text-xs text-text-tertiary">{statusLabel}</span>
        </span>
        {resource.locator?.startsWith('http') ? (
          <ExternalLink className="size-3.5 shrink-0 text-text-tertiary" />
        ) : null}
      </Button>
      {originalPath ? (
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Open original ${resource.title}`}
            title="Open original"
            onClick={() => void api.openPath(originalPath)}
          >
            <ExternalLink className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Reveal original ${resource.title}`}
            title="Reveal original"
            onClick={() => void api.revealPath(originalPath)}
          >
            <FolderSearch className="size-3.5" />
          </Button>
        </>
      ) : null}
      {resourceCanRetry(resource) ? (
        <Button
          variant="ghost"
          size="xs"
          className="mr-2"
          aria-label={`Retry ${resource.title}`}
          disabled={retrying}
          aria-disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </Button>
      ) : null}
    </div>
  )
}

const FILTERS: readonly { readonly id: SessionResourceFilter; readonly label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'sources', label: 'Sources' },
  { id: 'outputs', label: 'Outputs' },
  { id: 'images', label: 'Images' },
]

export function SessionResourcesPanel({
  sessionId,
  initialFilter = 'all',
  onClose,
}: {
  readonly sessionId: string | null
  readonly initialFilter?: SessionResourceFilter
  readonly onClose: () => void
}) {
  const [filter, setFilter] = useState<SessionResourceFilter>(initialFilter)
  const [visibleCount, setVisibleCount] = useState(RESOURCE_PAGE_SIZE)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const retryingRef = useRef(false)
  const queryClient = useQueryClient()
  const query = useSessionResources(sessionId)
  const resources = filteredResources(query.data ?? [], filter)
  const visibleResources = resources.slice(0, visibleCount)

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

  return (
    <section className="flex size-full min-h-0 flex-col bg-diff-bg" aria-label="Session resources">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Image className="size-4 text-text-tertiary" />
          <h2 className="truncate text-sm font-semibold text-text-primary">Sources & outputs</h2>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close resources" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      <nav
        className="flex shrink-0 gap-1 border-b border-border px-3 py-2"
        aria-label="Resource filters"
      >
        {FILTERS.map((item) => (
          <Button
            key={item.id}
            variant={filter === item.id ? 'subtle' : 'ghost'}
            size="xs"
            aria-pressed={filter === item.id}
            onClick={() => {
              setFilter(item.id)
              setVisibleCount(RESOURCE_PAGE_SIZE)
            }}
          >
            {item.label}
          </Button>
        ))}
      </nav>
      <div
        className={cn(
          'min-h-0 flex-1 space-y-2 overflow-y-auto p-3',
          query.isLoading && 'opacity-60',
        )}
      >
        {retryError ? (
          <p
            className="rounded-md border border-error/30 bg-error/5 px-3 py-2 text-sm text-error"
            role="alert"
          >
            {retryError}
          </p>
        ) : null}
        {query.isError ? (
          <SessionResourcesCatalogFailure onRetry={() => void query.refetch()} />
        ) : null}
        {visibleResources.map((resource, index) => {
          const group = resourceGroupLabel(resource)
          const previous = visibleResources[index - 1]
          return (
            <div key={resource.id}>
              {!previous || resourceGroupLabel(previous) !== group ? (
                <h3 className="mb-1 mt-3 px-1 text-xs font-semibold text-text-tertiary first:mt-0">
                  {group}
                </h3>
              ) : null}
              <ResourceRow
                resource={resource}
                sessionId={sessionId ?? ''}
                retrying={retryingId === resource.id}
                onRetry={() => void retryResource(resource.id)}
              />
            </div>
          )
        })}
        {visibleResources.length < resources.length ? (
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
