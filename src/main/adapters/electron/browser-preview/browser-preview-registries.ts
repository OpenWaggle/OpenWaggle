import type { WebContents } from 'electron'
import type { BrowserPreviewOwnerRecord, BrowserPreviewRecord } from './browser-preview-records'
import { BrowserPreviewRecordRegistry } from '../../browser-preview/browser-preview-record-registry'
import { BrowserPreviewShutdown } from '../../browser-preview/browser-preview-shutdown'
import { browserWindowFromWebContents } from '../electron-window-policy'

/** Electron's owner pages: a `WebContents` in a `BrowserWindow` that hosts its previews. */
export function createBrowserPreviewRecordRegistry(
  disposeRecord: (record: BrowserPreviewRecord) => void,
) {
  return new BrowserPreviewRecordRegistry<
    WebContents,
    BrowserPreviewOwnerRecord,
    BrowserPreviewRecord
  >({
    disposeRecord,
    ownerWindowOf: browserWindowFromWebContents,
    createOwner: (sender) => {
      const window = browserWindowFromWebContents(sender)
      if (!window) throw new Error('Browser previews require a live owner window.')
      return { sender, window, previews: new Map(), shortcutBindings: [], removeListeners: [] }
    },
  })
}

/** Shutdown tracking of Electron previews, which end when their `WebContents` is destroyed. */
export function createBrowserPreviewShutdown(
  closeRecord: (record: BrowserPreviewRecord) => Promise<void>,
) {
  return new BrowserPreviewShutdown<BrowserPreviewRecord>(closeRecord, (record, listener) =>
    record.view.webContents.once('destroyed', listener),
  )
}
