import type { BrowserPreviewAutomationPage } from './browser-preview-automation-control'
import { synchronizeBrowserPreviewControllerOverlay } from './browser-preview-controller-overlay'
import { sendBrowserPreviewOwnerEvent } from './browser-preview-owner-events'
import type { BrowserPreviewRecord } from './browser-preview-records'

/** Canonical controller identity shared by user controls and Pi automation. */
export function browserPreviewAutomationPage(
  record: BrowserPreviewRecord,
): BrowserPreviewAutomationPage {
  return {
    tabId: `${String(record.owner.sender.id)}:${record.previewId}`,
    contents: record.view.webContents,
    onControllerChange: (controller) => {
      if (record.disposed) return
      record.state = { ...record.state, controller }
      void synchronizeBrowserPreviewControllerOverlay(record.view.webContents, controller).catch(
        () => undefined,
      )
      sendBrowserPreviewOwnerEvent(record, {
        channel: 'browser-preview:state',
        payload: record.state,
      })
    },
  }
}
