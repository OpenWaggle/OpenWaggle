import { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
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
import { SessionResourceViewerHeader } from './SessionResourceViewerHeader'
import { SessionResourceViewerNavigation } from './SessionResourceViewerNavigation'
import { useCenteredImageZoom } from './useCenteredImageZoom'

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
      if (
        target instanceof HTMLElement &&
        (target.matches('input, select, textarea') || target.isContentEditable)
      ) {
        return
      }
      const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      const next = offset === 0 ? undefined : images[index + offset]
      if (next) {
        event.preventDefault()
        open(sessionId, next.id)
      }
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

function useSessionResourceRetry(
  sessionId: string | null,
  resource: SessionResource | null,
  retryKey: string,
  refetch: () => Promise<unknown>,
) {
  const queryClient = useQueryClient()
  const retryingRef = useRef(false)
  const [retryState, setRetryState] = useState<{
    readonly key: string
    readonly retrying: boolean
    readonly error: string | null
  }>({ key: retryKey, retrying: false, error: null })
  const current =
    retryState.key === retryKey ? retryState : { key: retryKey, retrying: false, error: null }
  return {
    ...current,
    retry: async () => {
      if (!sessionId || !resource || retryingRef.current) return
      retryingRef.current = true
      setRetryState({ key: retryKey, retrying: true, error: null })
      try {
        await api.retrySessionResource(SessionId(sessionId), resource.id)
        await queryClient.invalidateQueries({ queryKey: sessionResourcesQueryKey(sessionId) })
        await refetch()
      } catch (cause) {
        setRetryState({
          key: retryKey,
          retrying: false,
          error: cause instanceof Error ? cause.message : 'Could not retry this image.',
        })
      } finally {
        retryingRef.current = false
        setRetryState((state) => (state.key === retryKey ? { ...state, retrying: false } : state))
      }
    },
  }
}

function viewerContentIdentity(sessionId: string | null, resource: SessionResource | null) {
  return {
    sessionId: sessionId ?? 'none',
    resourceId: resource?.id ?? 'none',
    updatedAt: resource?.updatedAt ?? 0,
  }
}

function viewerResourceFlags(resource: SessionResource | null, sessionIsActive: boolean) {
  const locator = resource?.locator ?? ''
  return {
    enabled: sessionIsActive && resource?.kind === 'image',
    remote: locator.startsWith('https://'),
    managed: resource?.managed === true || locator.startsWith('session-resource://'),
  }
}

function useRemoteResourceProjectionRefresh(
  sessionId: string | null,
  remote: boolean,
  hasContentOrError: boolean,
) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!hasContentOrError || !sessionId || !remote) return
    void queryClient.invalidateQueries({ queryKey: sessionResourcesQueryKey(sessionId) })
  }, [hasContentOrError, queryClient, remote, sessionId])
}

function viewerSourceState(
  data: { readonly mimeType: string; readonly dataBase64: string } | null | undefined,
  state: { readonly pending: boolean; readonly error: boolean; readonly success: boolean },
  managed: boolean,
) {
  return {
    source: data ? contentUrl(data) : null,
    loading: state.pending,
    failed: state.error || (managed && state.success && data === null),
  }
}

function useViewerSource(
  sessionId: string | null,
  resource: SessionResource | null,
  sessionIsActive: boolean,
) {
  const identity = viewerContentIdentity(sessionId, resource)
  const flags = viewerResourceFlags(resource, sessionIsActive)
  const retryKey = `${identity.sessionId}:${identity.resourceId}`
  const content = useQuery({
    ...sessionResourceContentQueryOptions(
      identity.sessionId,
      identity.resourceId,
      identity.updatedAt,
    ),
    enabled: flags.enabled,
  })
  useRemoteResourceProjectionRefresh(
    sessionId,
    flags.remote,
    Boolean(content.data || content.isError),
  )
  const retry = useSessionResourceRetry(sessionId, resource, retryKey, content.refetch)
  const source = viewerSourceState(
    content.data,
    { pending: content.isPending, error: content.isError, success: content.isSuccess },
    flags.managed,
  )
  return {
    ...source,
    retrying: retry.retrying,
    retryError: retry.error,
    retry: retry.retry,
  }
}

function selectedZoom(
  resource: SessionResource | null,
  zoomState: { readonly resourceId: string; readonly zoom: Zoom } | undefined,
): Zoom {
  return resource && zoomState?.resourceId === resource.id ? zoomState.zoom : 'fit'
}

function selectedResourceId(resource: SessionResource | null) {
  return resource?.id ?? null
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
  const viewerSource = useViewerSource(
    viewerSessionId,
    resource,
    viewerSessionId !== null && viewerSessionId === activeSessionId,
  )
  const zoom = selectedZoom(resource, zoomState)
  const centeredZoom = useCenteredImageZoom(selectedResourceId(resource), zoom)

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
        <SessionResourceViewerHeader
          resource={resource}
          index={index}
          count={images.length}
          zoom={zoom}
          source={viewerSource.source}
          onZoomChange={(next) => {
            centeredZoom.captureCenter(next)
            setZoomState({ resourceId: resource.id, zoom: next })
          }}
          onClose={close}
        />
        <SessionResourceViewerNavigation
          index={index}
          count={images.length}
          onNavigate={navigate}
        />
        {viewerSource.loading ? (
          <output className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-text-secondary">
            Loading image…
          </output>
        ) : viewerSource.failed ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-text-secondary">This image is currently unavailable.</p>
            {viewerSource.retryError ? (
              <p className="text-sm text-error" role="alert">
                {viewerSource.retryError}
              </p>
            ) : null}
            <Button
              variant="secondary"
              disabled={viewerSource.retrying}
              aria-disabled={viewerSource.retrying}
              onClick={() => void viewerSource.retry()}
            >
              {viewerSource.retrying ? 'Retrying image…' : 'Retry image'}
            </Button>
          </div>
        ) : (
          <SessionResourceViewerCanvas
            resource={resource}
            source={viewerSource.source}
            zoom={zoom}
            canvasRef={centeredZoom.viewportRef}
          />
        )}
      </div>
    </ModalDialog>
  )
}
