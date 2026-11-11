import type { WebContents } from 'electron'
import { BrowserPreviewOwnerRegistry } from '../../browser-preview/browser-preview-owner-registry'
import { browserWindowFromWebContents } from '../electron-window-policy'

/** Electron's owner leases: an owner page lives in a `BrowserWindow` whose `closed` ends it. */
export const browserPreviewOwnerRegistry = new BrowserPreviewOwnerRegistry<WebContents>((sender) =>
  browserWindowFromWebContents(sender),
)
