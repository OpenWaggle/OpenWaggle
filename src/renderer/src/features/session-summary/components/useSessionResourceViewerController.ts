import type { SessionResource, SessionResourceImageLocation } from '@shared/types/session-resource'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey'
import { useUIStore } from '@/shell/ui-store'
import { useSessionResourceBranchNames } from '../hooks/useSessionResourceBranchNames'
import { useSessionImageLocation, useSessionResourceCatalog } from '../hooks/useSessionResources'
import { orderedSessionImages } from '../model/session-resource-gallery'
import { isViewableSessionImage } from '../model/session-resource-viewability'
import type { ImageViewerZoom as Zoom } from './SessionResourceViewerCanvas'
import { useCenteredImageZoom } from './useCenteredImageZoom'
import { useViewerResourceActions, useViewerSource } from './useSessionResourceViewerActions'

const GALLERY_PREFETCH_DISTANCE = 2

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
  previousResourceId: string | null,
  nextResourceId: string | null,
  open: (sessionId: string, resourceId: string) => void,
) {
  useEffect(() => {
    if (!viewerSessionId) return
    const sessionId = viewerSessionId
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target
      const fromInteractiveControl =
        target instanceof Element &&
        target.closest('input, select, textarea, [contenteditable="true"], [role="slider"]')
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
      const resourceId =
        event.key === 'ArrowLeft'
          ? previousResourceId
          : event.key === 'ArrowRight'
            ? nextResourceId
            : null
      if (!resourceId) return
      event.preventDefault()
      open(sessionId, resourceId)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [nextResourceId, open, previousResourceId, viewerSessionId])
}

function selectedImage(resourceId: string | null, images: readonly SessionResource[]) {
  if (!resourceId) return { index: -1, resource: null }
  const index = images.findIndex((resource) => resource.id === resourceId)
  return { index, resource: index >= 0 ? (images[index] ?? null) : null }
}

function selectedZoom(
  resource: SessionResource | null,
  zoomState: { readonly resourceId: string; readonly zoom: Zoom } | undefined,
): Zoom {
  return resource && zoomState?.resourceId === resource.id ? zoomState.zoom : 'fit'
}

function galleryAdjacency(
  images: readonly SessionResource[],
  loadedIndex: number,
  location: SessionResourceImageLocation | null,
) {
  if (location) {
    return {
      index: location.index,
      previousResourceId: location.previous ? location.previous.id : null,
      nextResourceId: location.next ? location.next.id : null,
    }
  }
  return {
    index: loadedIndex,
    previousResourceId: images[loadedIndex - 1]?.id ?? null,
    nextResourceId: images[loadedIndex + 1]?.id ?? null,
  }
}

function resolveGalleryState(
  resources: readonly SessionResource[],
  firstPageRevision: string | undefined,
  activeMessageIds: ReadonlySet<string>,
  resourceId: string | null,
  location: SessionResourceImageLocation | null,
) {
  const serverImages = resources.filter(isViewableSessionImage)
  const images =
    firstPageRevision === 'legacy'
      ? orderedSessionImages(serverImages, activeMessageIds)
      : serverImages
  const loadedSelection = selectedImage(resourceId, images)
  const locatedImage = location?.resource ?? null
  const resource =
    locatedImage && isViewableSessionImage(locatedImage) ? locatedImage : loadedSelection.resource
  const adjacency = galleryAdjacency(images, loadedSelection.index, location)
  return {
    images,
    resource,
    loadedIndex: loadedSelection.index,
    ...adjacency,
    targetIsLoaded: resources.some(({ id }) => id === resourceId),
  }
}

function viewerIdentity(
  viewer: { readonly sessionId: string; readonly resourceId: string } | null,
) {
  return {
    sessionId: viewer ? viewer.sessionId : null,
    resourceId: viewer ? viewer.resourceId : null,
  }
}

function usePrefetchNextGalleryPage(
  index: number,
  loadedCount: number,
  hasNextPage: boolean,
  fetching: boolean,
  loadNextPage: () => Promise<void>,
) {
  useEffect(() => {
    if (index < 0 || index < loadedCount - GALLERY_PREFETCH_DISTANCE || !hasNextPage || fetching) {
      return
    }
    void loadNextPage()
  }, [fetching, hasNextPage, index, loadNextPage, loadedCount])
}

export function useSessionResourceViewerController(
  activeSessionId: string | null,
  activeBranchId: string | null,
  activeMessageIds: ReadonlySet<string>,
  activePathNodeIds: readonly string[],
) {
  const viewer = useUIStore((state) => state.resourceViewer)
  const close = useUIStore((state) => state.closeResourceViewer)
  const open = useUIStore((state) => state.openResourceViewer)
  const [zoomState, setZoomState] = useState<{ readonly resourceId: string; readonly zoom: Zoom }>()
  const activeSessionRef = useRef(activeSessionId)
  useLayoutEffect(() => {
    activeSessionRef.current = activeSessionId
  }, [activeSessionId])
  const identity = viewerIdentity(viewer)
  const viewerSessionId = identity.sessionId
  const sessionIsActive = viewerSessionId !== null && viewerSessionId === activeSessionId
  useEscapeHotkey(close, { enabled: sessionIsActive })
  const querySessionId = sessionIsActive ? viewerSessionId : null
  const branchNames = useSessionResourceBranchNames(querySessionId)
  const catalog = useSessionResourceCatalog(querySessionId, 'images', {
    activeBranchId,
    pathNodeIds: activePathNodeIds,
  })
  const imageLocation = useSessionImageLocation(
    querySessionId,
    identity.resourceId,
    activeBranchId,
    activePathNodeIds,
  )
  const gallery = resolveGalleryState(
    catalog.resources,
    catalog.data?.pages[0]?.orderRevision,
    activeMessageIds,
    identity.resourceId,
    imageLocation.data ?? null,
  )
  const source = useViewerSource(querySessionId, gallery.resource, sessionIsActive)
  const actions = useViewerResourceActions(viewerSessionId, gallery.resource, activeSessionRef)
  const zoom = selectedZoom(gallery.resource, zoomState)
  const centeredZoom = useCenteredImageZoom(
    gallery.resource ? gallery.resource.id : null,
    zoom,
    source.source !== null,
  )
  const changeZoom = (next: Zoom) => {
    centeredZoom.captureCenter(next)
    setZoomState({ resourceId: gallery.resource ? gallery.resource.id : 'none', zoom: next })
  }

  useCloseViewerOnSessionChange(viewerSessionId, activeSessionId, close)
  useViewerKeyboardNavigation(
    viewerSessionId,
    gallery.previousResourceId,
    gallery.nextResourceId,
    open,
  )
  usePrefetchNextGalleryPage(
    gallery.loadedIndex,
    gallery.images.length,
    catalog.hasNextPage,
    catalog.isFetchingNextPage,
    catalog.loadNextPage,
  )

  return {
    viewer,
    close,
    open,
    viewerSessionId,
    branchNames,
    catalog,
    imageLocation,
    ...gallery,
    source,
    actions,
    zoom,
    centeredZoom,
    changeZoom,
  }
}
