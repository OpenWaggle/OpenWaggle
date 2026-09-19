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
  navigatePrevious: () => void,
  navigateNext: () => void,
) {
  useEffect(() => {
    if (!viewerSessionId) return
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
      if (event.key === 'ArrowLeft' && previousResourceId) {
        event.preventDefault()
        navigatePrevious()
        return
      }
      if (event.key === 'ArrowRight' && nextResourceId) {
        event.preventDefault()
        navigateNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigateNext, navigatePrevious, nextResourceId, previousResourceId, viewerSessionId])
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

function messageGalleryAdjacency(
  resourceId: string | null,
  galleryResourceIds: readonly string[] | undefined,
  galleryIndex: number | undefined,
) {
  if (!resourceId || !galleryResourceIds) return null
  const index =
    galleryIndex !== undefined && galleryResourceIds[galleryIndex] === resourceId
      ? galleryIndex
      : galleryResourceIds.indexOf(resourceId)
  if (index < 0) return null
  const count = galleryResourceIds.length
  return {
    index,
    count,
    messageScoped: true,
    previousResourceId:
      count > 1 ? (galleryResourceIds[(index - 1 + count) % count] ?? null) : null,
    nextResourceId: count > 1 ? (galleryResourceIds[(index + 1) % count] ?? null) : null,
  }
}

function galleryAdjacency(
  images: readonly SessionResource[],
  loadedIndex: number,
  location: SessionResourceImageLocation | null,
  resourceId: string | null,
  galleryResourceIds: readonly string[] | undefined,
  galleryIndex: number | undefined,
) {
  const message = messageGalleryAdjacency(resourceId, galleryResourceIds, galleryIndex)
  if (message) return message
  if (location) {
    return {
      index: location.index,
      count: null,
      messageScoped: false,
      previousResourceId: location.previous ? location.previous.id : null,
      nextResourceId: location.next ? location.next.id : null,
    }
  }
  return {
    index: loadedIndex,
    count: null,
    messageScoped: false,
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
  galleryResourceIds: readonly string[] | undefined,
  galleryIndex: number | undefined,
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
  const adjacency = galleryAdjacency(
    images,
    loadedSelection.index,
    location,
    resourceId,
    galleryResourceIds,
    galleryIndex,
  )
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
    viewer?.galleryResourceIds,
    viewer?.galleryIndex,
  )
  const displayTitle = gallery.messageScoped ? viewer?.galleryTitles?.[gallery.index] : undefined
  const resource =
    gallery.resource && displayTitle
      ? { ...gallery.resource, title: displayTitle }
      : gallery.resource
  const source = useViewerSource(querySessionId, resource, sessionIsActive, displayTitle)
  const actions = useViewerResourceActions(
    viewerSessionId,
    resource,
    activeSessionRef,
    displayTitle,
  )
  const zoom = selectedZoom(resource, zoomState)
  const centeredZoom = useCenteredImageZoom(
    resource ? resource.id : null,
    zoom,
    source.source !== null,
  )
  const changeZoom = (next: Zoom) => {
    centeredZoom.captureCenter(next)
    setZoomState({ resourceId: resource ? resource.id : 'none', zoom: next })
  }

  const navigatePrevious = () => {
    if (!viewerSessionId || !gallery.previousResourceId) return
    open(
      viewerSessionId,
      gallery.previousResourceId,
      viewer?.galleryResourceIds,
      viewer?.galleryIndex === undefined || !gallery.messageScoped || gallery.count === null
        ? undefined
        : (gallery.index - 1 + gallery.count) % gallery.count,
      viewer?.galleryTitles,
    )
  }
  const navigateNext = () => {
    if (!viewerSessionId || !gallery.nextResourceId) return
    open(
      viewerSessionId,
      gallery.nextResourceId,
      viewer?.galleryResourceIds,
      viewer?.galleryIndex === undefined || !gallery.messageScoped || gallery.count === null
        ? undefined
        : (gallery.index + 1) % gallery.count,
      viewer?.galleryTitles,
    )
  }

  useCloseViewerOnSessionChange(viewerSessionId, activeSessionId, close)
  useViewerKeyboardNavigation(
    viewerSessionId,
    gallery.previousResourceId,
    gallery.nextResourceId,
    navigatePrevious,
    navigateNext,
  )
  usePrefetchNextGalleryPage(
    gallery.loadedIndex,
    gallery.images.length,
    !gallery.messageScoped && catalog.hasNextPage,
    catalog.isFetchingNextPage,
    catalog.loadNextPage,
  )

  return {
    viewer,
    close,
    navigatePrevious,
    navigateNext,
    viewerSessionId,
    branchNames,
    catalog,
    imageLocation,
    ...gallery,
    resource,
    source,
    actions,
    zoom,
    centeredZoom,
    changeZoom,
  }
}
