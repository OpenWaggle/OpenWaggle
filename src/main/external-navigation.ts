import type { WebContents } from 'electron'
import { openExternal } from './desktop-ui'
import { describeError } from './error-description'
import { createLogger } from './logger'
import { isTrustedRendererDocument } from './renderer-document-trust'
import { isSessionResourceDownloadNavigation } from './session-resource-protocol'

const logger = createLogger('main/external-navigation')

export function installExternalNavigationGuard(webContents: WebContents) {
  webContents.setWindowOpenHandler((details) => {
    openExternalFromRenderer(details.url)
    return { action: 'deny' }
  })
  webContents.on('will-navigate', (event, url) => {
    if (isSessionResourceDownloadNavigation(url, webContents.id, webContents.getURL())) return
    if (!isTrustedRendererDocument(url)) {
      event.preventDefault()
      openExternalFromRenderer(url)
    }
  })
}

export function externalNavigationProtocol(url: string) {
  try {
    return new URL(url).protocol
  } catch {
    return 'invalid'
  }
}

export function openExternalFromRenderer(url: string) {
  void openExternal(url).catch((error: unknown) => {
    logger.warn('External navigation was not opened', {
      error: describeError(error),
      protocol: externalNavigationProtocol(url),
    })
  })
}
