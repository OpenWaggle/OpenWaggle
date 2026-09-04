import type { SessionResource } from '@shared/types/session-resource'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ModalDialog } from '@/shared/ui/ModalDialog'
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
import {
  SessionResourceViewerCatalogState,
  SessionResourceViewerHeader,
  VIEWER_DIALOG_CLASS,
} from './SessionResourceViewerChrome'

const EMPTY_MESSAGE_IDS: ReadonlySet<string> = new Set()

function contentUrl(content: { readonly mimeType: string; readonly dataBase64: string }) {
  return `data:${content.mimeType};base64,${content.dataBase64}`
}

function belongsToActivePath(resource: SessionResource, activeMessageIds: ReadonlySet<string>) {
  return resource.occurrences.some(
    (occurrence) => occurrence.nodeId !== null && activeMessageIds.has(occurrence.nodeId),
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
      const target = event.target
      const fromInteractiveControl =
        target instanceof Element &&
        target.closest('button, input, select, textarea, [contenteditable="true"], [role="slider"]')
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        fromInteractiveControl
      ) {
        return
      }
      const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      const next = offset === 0 ? undefined : images[index + offset]
      if (!next) return
      event.preventDefault()
      open(sessionId, next.id)
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
    ...sessionResourceContentQueryOptions(
      sessionId ?? 'none',
      resource?.id ?? 'none',
      resource?.updatedAt ?? 0,
    ),
    enabled: sessionIsActive && resource?.kind === 'image',
  })
  const remoteLocator = resource?.locator?.startsWith('https://') === true
  useEffect(() => {
    if (!content.data || !sessionId || !remoteLocator) return
    void queryClient.invalidateQueries({ queryKey: sessionResourcesQueryKey(sessionId) })
  }, [content.data, queryClient, remoteLocator, sessionId])
  return {
    source: content.data ? contentUrl(content.data) : null,
    loading: content.isLoading,
    errorMessage: content.error?.message ?? null,
    retry: content.refetch,
  }
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
  const sourceState = useViewerSource(
    viewerSessionId,
    resource,
    viewerSessionId !== null && viewerSessionId === activeSessionId,
  )
  const zoom = selectedZoom(resource, zoomState)

  useCloseViewerOnSessionChange(viewerSessionId, activeSessionId, close)
  useViewerKeyboardNavigation(viewerSessionId, images, index, open)

  if (!viewer || viewerSessionId !== activeSessionId) return null
  if (!resource) {
    return (
      <SessionResourceViewerCatalogState
        loading={resourcesQuery.isLoading}
        errorMessage={resourcesQuery.error?.message ?? null}
        onRetry={() => void resourcesQuery.refetch()}
        onClose={close}
      />
    )
  }

  const navigate = (nextIndex: number) => {
    const next = images[nextIndex]
    if (next) open(viewer.sessionId, next.id)
  }

  return (
    <ModalDialog
      label={`Image viewer: ${resource.title}`}
      onClose={close}
      className={VIEWER_DIALOG_CLASS}
    >
      <div className="flex h-full min-h-0 flex-col">
        <SessionResourceViewerHeader
          resource={resource}
          index={index}
          count={images.length}
          zoom={zoom}
          source={sourceState.source}
          onZoomChange={(next) => setZoomState({ resourceId: resource.id, zoom: next })}
          onClose={close}
        />
        <SessionResourceViewerCanvas
          resource={resource}
          source={sourceState.source}
          loading={sourceState.loading}
          errorMessage={sourceState.errorMessage}
          zoom={zoom}
          navigation={{ index, count: images.length, onNavigate: navigate }}
          onRetry={() => void sourceState.retry()}
        />
      </div>
    </ModalDialog>
  )
}
