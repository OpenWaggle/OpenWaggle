import type { WebContents } from 'electron'
import { isTrustedRendererDocument } from '../../renderer-document-trust'
import { isSessionResourceDownloadNavigation } from '../../session-resource-protocol'

/**
 * Keeps a page on the app's own documents: a new window or a navigation anywhere else is
 * refused and handed to `openLink` (the app's link policy, `openExternalFromRenderer`).
 */
export function installExternalNavigationGuard(
  webContents: WebContents,
  openLink: (url: string) => void,
) {
  webContents.setWindowOpenHandler((details) => {
    openLink(details.url)
    return { action: 'deny' }
  })
  webContents.on('will-navigate', (event, url) => {
    if (isSessionResourceDownloadNavigation(url, webContents.id, webContents.getURL())) return
    if (!isTrustedRendererDocument(url)) {
      event.preventDefault()
      openLink(url)
    }
  })
}
