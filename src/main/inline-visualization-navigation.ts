import { type WebContents, type WebFrameMain, webFrameMain } from 'electron'
import {
  isInlineVisualizationUrl,
  shouldBlockInlineVisualizationDocumentRequest,
  shouldBlockInlineVisualizationFrameNavigation,
} from './security/electron-security'

function frameKey(frame: WebFrameMain) {
  return `${String(frame.processId)}:${frame.frameToken}`
}

export function installInlineVisualizationNavigationGuard(webContents: WebContents) {
  const visualizationFrames = new Set<string>()
  const pruneDetachedFrames = () => {
    const activeFrames = new Set(webContents.mainFrame.framesInSubtree.map(frameKey))
    for (const key of visualizationFrames) {
      if (!activeFrames.has(key)) visualizationFrames.delete(key)
    }
  }
  webContents.on(
    'did-frame-navigate',
    (_event, url, _responseCode, _statusText, isMainFrame, processId, routingId) => {
      pruneDetachedFrames()
      if (isMainFrame || !isInlineVisualizationUrl(url)) return
      const frame = webFrameMain.fromId(processId, routingId)
      if (frame) visualizationFrames.add(frameKey(frame))
    },
  )
  webContents.on('will-frame-navigate', (event) => {
    pruneDetachedFrames()
    const shouldBlock = shouldBlockInlineVisualizationFrameNavigation({
      isMainFrame: event.isMainFrame,
      destinationUrl: event.url,
      ...(event.frame ? { frameUrl: event.frame.url } : {}),
      frameIsVisualization: event.frame ? visualizationFrames.has(frameKey(event.frame)) : false,
      ...(event.initiator ? { initiatorUrl: event.initiator.url } : {}),
    })
    if (shouldBlock) event.preventDefault()
  })
  webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({
      cancel: shouldBlockInlineVisualizationDocumentRequest({
        resourceType: details.resourceType,
        requestUrl: details.url,
        ...(details.frame ? { frameUrl: details.frame.url } : {}),
      }),
    })
  })
}
