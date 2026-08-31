import { isMatching, P } from '@diegogbrisa/ts-match'
import type { SessionResource } from '@shared/types/session-resource'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { Select } from '@/shared/ui/Select'
import { useUIStore } from '@/shell/ui-store'
import {
  sessionResourceContentQueryOptions,
  sessionResourcesQueryKey,
  useSessionResources,
} from '../hooks/useSessionResources'
import { isViewableSessionImage } from '../model/session-resource-viewability'
import {
  SessionResourceViewerCanvas,
  type ImageViewerZoom as Zoom,
} from './SessionResourceViewerCanvas'

const EMPTY_MESSAGE_IDS: ReadonlySet<string> = new Set()

function contentUrl(content: { readonly mimeType: string; readonly dataBase64: string }) {
  return `data:${content.mimeType};base64,${content.dataBase64}`
}

function downloadResource(resource: SessionResource, url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = resource.title
  anchor.click()
}

function belongsToActivePath(resource: SessionResource, activeMessageIds: ReadonlySet<string>) {
  return resource.occurrences.some(
    (occurrence) => occurrence.nodeId !== null && activeMessageIds.has(occurrence.nodeId),
  )
}

function ViewerHeader({
  resource,
  index,
  count,
  zoom,
  source,
  onZoomChange,
  onClose,
}: {
  readonly resource: SessionResource
  readonly index: number
  readonly count: number
  readonly zoom: Zoom
  readonly source: string | null
  readonly onZoomChange: (zoom: Zoom) => void
  readonly onClose: () => void
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary">{resource.title}</p>
        <p className="text-xs text-text-tertiary">
          {index + 1} of {count}
        </p>
      </div>
      <Select
        aria-label="Image zoom"
        selectSize="xs"
        value={zoom}
        onChange={(event) => {
          if (isMatching(P.union('fit', '25', '50', '100', '150', '200'), event.target.value)) {
            onZoomChange(event.target.value)
          }
        }}
      >
        <option value="fit">Fit</option>
        <option value="25">25%</option>
        <option value="50">50%</option>
        <option value="100">100%</option>
        <option value="150">150%</option>
        <option value="200">200%</option>
      </Select>
      <ViewerResourceAction resource={resource} source={source} />
      <Button variant="ghost" size="icon-sm" aria-label="Close image viewer" onClick={onClose}>
        <X className="size-4" />
      </Button>
    </header>
  )
}

function ViewerResourceAction({
  resource,
  source,
}: {
  readonly resource: SessionResource
  readonly source: string | null
}) {
  if (source) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Download image"
        onClick={() => downloadResource(resource, source)}
      >
        <Download className="size-4" />
      </Button>
    )
  }
  if (!resource.locator?.startsWith('http')) return null
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Open image source"
      onClick={() => void api.openExternal(resource.locator ?? '')}
    >
      <ExternalLink className="size-4" />
    </Button>
  )
}

function useCloseViewerOnSessionChange(
  viewerSessionId: string | null,
  activeSessionId: string | null,
  close: () => void,
) {
  useEffect(() => {
    if (viewerSessionId && viewerSessionId !== activeSessionId) close()
  }, [activeSessionId, close, viewerSessionId])
}

function useViewerKeyboardNavigation(
  viewerSessionId: string | null,
  images: readonly SessionResource[],
  index: number,
  open: (sessionId: string, resourceId: string) => void,
) {
  useEffect(() => {
    if (!viewerSessionId) return
    const sessionId = viewerSessionId
    function handleKeyDown(event: KeyboardEvent) {
      const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      const next = offset === 0 ? undefined : images[index + offset]
      if (next) open(sessionId, next.id)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [images, index, open, viewerSessionId])
}

function orderedImages(
  resources: readonly SessionResource[] | undefined,
  activeMessageIds: ReadonlySet<string>,
) {
  return (resources ?? []).filter(isViewableSessionImage).sort((left, right) => {
    const pathOrder =
      Number(belongsToActivePath(right, activeMessageIds)) -
      Number(belongsToActivePath(left, activeMessageIds))
    if (pathOrder !== 0) return pathOrder
    const timeOrder = left.updatedAt - right.updatedAt
    return timeOrder !== 0 ? timeOrder : left.id.localeCompare(right.id)
  })
}

function selectedImage(resourceId: string | null, images: readonly SessionResource[]) {
  if (!resourceId) return { index: -1, resource: null }
  const index = images.findIndex((resource) => resource.id === resourceId)
  return { index, resource: index >= 0 ? (images[index] ?? null) : null }
}

function useViewerSource(
  sessionId: string | null,
  resource: SessionResource | null,
  sessionIsActive: boolean,
) {
  const queryClient = useQueryClient()
  const content = useQuery({
    ...sessionResourceContentQueryOptions(sessionId ?? 'none', resource?.id ?? 'none'),
    enabled: sessionIsActive && resource?.kind === 'image',
  })
  const remoteLocator = resource?.locator?.startsWith('https://') === true
  useEffect(() => {
    if (!content.data || !sessionId || !remoteLocator) return
    void queryClient.invalidateQueries({ queryKey: sessionResourcesQueryKey(sessionId) })
  }, [content.data, queryClient, remoteLocator, sessionId])
  return content.data ? contentUrl(content.data) : null
}

function selectedZoom(
  resource: SessionResource | null,
  zoomState: { readonly resourceId: string; readonly zoom: Zoom } | undefined,
): Zoom {
  return resource && zoomState?.resourceId === resource.id ? zoomState.zoom : 'fit'
}

export function SessionResourceViewer({
  activeSessionId,
  activeMessageIds = EMPTY_MESSAGE_IDS,
}: {
  readonly activeSessionId: string | null
  readonly activeMessageIds?: ReadonlySet<string>
}) {
  const viewer = useUIStore((state) => state.resourceViewer)
  const close = useUIStore((state) => state.closeResourceViewer)
  const open = useUIStore((state) => state.openResourceViewer)
  const [zoomState, setZoomState] = useState<{ readonly resourceId: string; readonly zoom: Zoom }>()
  const viewerSessionId = viewer?.sessionId ?? null
  const resourcesQuery = useSessionResources(viewerSessionId)
  const images = orderedImages(resourcesQuery.data, activeMessageIds)
  const { index, resource } = selectedImage(viewer?.resourceId ?? null, images)
  const source = useViewerSource(
    viewerSessionId,
    resource,
    viewerSessionId !== null && viewerSessionId === activeSessionId,
  )
  const zoom = selectedZoom(resource, zoomState)

  useCloseViewerOnSessionChange(viewerSessionId, activeSessionId, close)
  useViewerKeyboardNavigation(viewerSessionId, images, index, open)

  if (!viewer || !resource || viewerSessionId !== activeSessionId) return null

  const navigate = (nextIndex: number) => {
    const next = images[nextIndex]
    if (next) open(viewer.sessionId, next.id)
  }

  return (
    <ModalDialog
      label={`Image viewer: ${resource.title}`}
      onClose={close}
      className="size-full max-h-none max-w-none overflow-hidden rounded-none border-0 bg-bg p-0"
    >
      <div className="flex h-full min-h-0 flex-col">
        <ViewerHeader
          resource={resource}
          index={index}
          count={images.length}
          zoom={zoom}
          source={source}
          onZoomChange={(next) => setZoomState({ resourceId: resource.id, zoom: next })}
          onClose={close}
        />
        <SessionResourceViewerCanvas
          resource={resource}
          source={source}
          zoom={zoom}
          index={index}
          count={images.length}
          onNavigate={navigate}
        />
      </div>
    </ModalDialog>
  )
}
