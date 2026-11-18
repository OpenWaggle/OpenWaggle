import type { Event, WebContentsDidStartNavigationEventParams } from 'electron'
import {
  captureBrowserPreviewFavicon,
  safeBrowserPreviewOrigin,
  selectBrowserPreviewFaviconCandidates,
} from './browser-preview-favicon-capture'
import type { BrowserPreviewEventActions, BrowserPreviewRecord } from './browser-preview-records'

interface ActiveFaviconCapture {
  readonly controller: AbortController
  readonly documentGeneration: number
  readonly eventKey: string
  readonly requestId: number
}

export function faviconAfterBrowserPreviewNavigation(
  record: BrowserPreviewRecord,
  nextUrl: string,
) {
  const favicon = record.state.favicon
  if (favicon === null) return null
  return safeBrowserPreviewOrigin(favicon.pageUrl) === safeBrowserPreviewOrigin(nextUrl)
    ? favicon
    : null
}

export function monitorBrowserPreviewFavicon(
  record: BrowserPreviewRecord,
  actions: BrowserPreviewEventActions,
) {
  const contents = record.view.webContents
  let documentGeneration = 0
  let requestSequence = 0
  let active: ActiveFaviconCapture | null = null
  let disposed = false

  const cancel = () => {
    documentGeneration += 1
    active?.controller.abort()
    active = null
  }
  const onNavigationStart = (event: Event<WebContentsDidStartNavigationEventParams>) => {
    if (event.isMainFrame && !event.isSameDocument) cancel()
  }
  const onFavicon = (_event: Event, rawCandidates: string[]) => {
    const pageUrl = contents.getURL()
    if (safeBrowserPreviewOrigin(pageUrl) === null) return
    const candidates = selectBrowserPreviewFaviconCandidates(rawCandidates)
    if (candidates.length === 0) return
    const eventKey = JSON.stringify([pageUrl, ...candidates])
    if (active?.eventKey === eventKey) return
    active?.controller.abort()
    const controller = new AbortController()
    const requestId = ++requestSequence
    const capture = {
      controller,
      documentGeneration,
      eventKey,
      requestId,
    }
    active = capture
    void captureBrowserPreviewFavicon({
      webContents: contents,
      pageUrl,
      candidates,
      signal: controller.signal,
    })
      .then((result) => {
        if (
          result.kind !== 'captured' ||
          disposed ||
          controller.signal.aborted ||
          contents.isDestroyed() ||
          active?.requestId !== requestId ||
          documentGeneration !== capture.documentGeneration ||
          safeBrowserPreviewOrigin(contents.getURL()) !== safeBrowserPreviewOrigin(pageUrl)
        ) {
          return
        }
        record.state = {
          ...record.state,
          favicon: {
            dataUrl: result.dataUrl,
            pageUrl: safeBrowserPreviewOrigin(pageUrl) ?? pageUrl,
            capturedAt: Date.now(),
          },
        }
        actions.emitState()
      })
      .catch(() => undefined)
      .finally(() => {
        if (active?.requestId === requestId) active = null
      })
  }

  contents.on('did-start-navigation', onNavigationStart)
  contents.on('page-favicon-updated', onFavicon)
  return () => {
    disposed = true
    cancel()
    contents.removeListener('did-start-navigation', onNavigationStart)
    contents.removeListener('page-favicon-updated', onFavicon)
  }
}
