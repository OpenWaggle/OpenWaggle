import { type WebContents, type WebFrameMain, webFrameMain } from 'electron'
import {
  isInlineVisualizationUrl,
  isMcpAppFrameUrl,
  shouldBlockInlineVisualizationDocumentRequest,
  shouldBlockInlineVisualizationFrameNavigation,
  shouldBlockMcpAppFrameNavigation,
} from './security/electron-security'
import { shouldBlockSessionResourceRequest } from './session-resource-protocol'

function frameKey(frame: WebFrameMain) {
  return `${String(frame.processId)}:${frame.frameToken}`
}

export function installInlineVisualizationNavigationGuard(webContents: WebContents) {
  const visualizationFrames = new Set<string>()
  /** Frames that loaded an MCP App document; they may not be navigated off it (ADR 0053). */
  const mcpAppFrames = new Set<string>()
  const pruneDetachedFrames = () => {
    const activeFrames = new Set(webContents.mainFrame.framesInSubtree.map(frameKey))
    for (const frames of [visualizationFrames, mcpAppFrames]) {
      for (const key of frames) {
        if (!activeFrames.has(key)) frames.delete(key)
      }
    }
  }
  webContents.on(
    'did-frame-navigate',
    (_event, url, _responseCode, _statusText, isMainFrame, processId, routingId) => {
      pruneDetachedFrames()
      if (isMainFrame) return
      const frames = isInlineVisualizationUrl(url)
        ? visualizationFrames
        : isMcpAppFrameUrl(url)
          ? mcpAppFrames
          : null
      if (!frames) return
      const frame = webFrameMain.fromId(processId, routingId)
      if (frame) frames.add(frameKey(frame))
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
    const leavesMcpApp = shouldBlockMcpAppFrameNavigation({
      isMainFrame: event.isMainFrame,
      isSameDocument: event.isSameDocument,
      destinationUrl: event.url,
      ...(event.frame ? { frameUrl: event.frame.url } : {}),
      frameIsMcpApp: event.frame ? mcpAppFrames.has(frameKey(event.frame)) : false,
    })
    if (shouldBlock || leavesMcpApp) event.preventDefault()
  })
  webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({
      cancel:
        shouldBlockSessionResourceRequest({
          url: details.url,
          ownerId: details.webContentsId,
          frameUrl: details.frame?.url,
          isMainFrame: details.frame?.parent === null,
        }) ||
        shouldBlockInlineVisualizationDocumentRequest({
          resourceType: details.resourceType,
          requestUrl: details.url,
          ...(details.frame ? { frameUrl: details.frame.url } : {}),
        }),
    })
  })
}
