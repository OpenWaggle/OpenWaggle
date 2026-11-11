import { webContents } from 'electron'
import type { BrowserPreviewAutomationPage } from '../../browser-preview/automation/browser-preview-automation-contents'
import { synchronizeBrowserPreviewControllerOverlay } from './browser-preview-controller-overlay'
import type { BrowserPreviewRecord } from './browser-preview-records'
import { sendBrowserPreviewOwnerEvent } from '../../browser-preview/browser-preview-owner-events'

/** Canonical controller identity shared by user controls and Pi automation. */
export function browserPreviewAutomationPage(record: BrowserPreviewRecord) {
  return {
    tabId: `${String(record.owner.sender.id)}:${record.previewId}`,
    contents: record.view.webContents,
    focusedContents: () => webContents.getFocusedWebContents(),
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
  } satisfies BrowserPreviewAutomationPage
}
